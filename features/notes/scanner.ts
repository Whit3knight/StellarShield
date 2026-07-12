// Scans deposit / borrow / repay events on the borrow-pool contract,
// tries to decrypt each attached memo with the wallet's shielded
// identity, and rebuilds the user's note inventory. Runs on wallet
// connect and whenever a new confirmation lands via the borrow-events
// bus, so notes survive fresh browsers / cleared localStorage without
// any explicit backup step.
//
// Event layout (matches contracts/borrow-pool/src/lib.rs):
//   ("deposit", asset)  -> (leafIndex: u64, memoBytes: Bytes)
//
// Later ops will add ("borrow", …) and ("repay", …) with the same
// memo-attached shape so a single scanner covers every tree.

import { deriveShieldedIdentity, tryDecryptAnyMemo } from "./memo"
import {
  DENOMINATION,
  SUPPORTED_ASSETS,
  computeCommitment,
  computeNullifier,
  type ShieldedAsset,
  type ShieldedNote,
} from "./note"
import { replaceNotes, snapshotNotes } from "./note-store"

import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Testnet event retention ≈ 24h @ 5s ledgers. Stay just under.
// Testnet event retention is nominally 24h (~17k ledgers @ 5s each)
// but the public RPC quietly returns 0 events once startLedger falls
// past the actual on-disk window (empirical: ~8k on the SDF testnet
// endpoint). Cap safely under that so scans never come back empty
// just because we overshot the retention edge.
const LEDGER_LOOKBACK = 10_000

type RpcEvent = {
  contractId?: string
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
  ledgerClosedAt?: string
}

export function eventOpenedAt(event: {
  ledgerClosedAt?: string
}): number | undefined {
  if (!event.ledgerClosedAt) return undefined
  const ms = Date.parse(event.ledgerClosedAt)
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}

/**
 * Drop notes whose nullifier appears in `spent`. Pure so it can be
 * exercised without spinning up an rpc mock.
 */
export function filterSpentNotes<
  T extends { sk: bigint; index: number }
>(notes: T[], spent: Set<bigint>): T[] {
  return notes.filter((note) => !spent.has(computeNullifier(note.sk, note.index)))
}

export type ScanIdentity = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  skField: bigint
}

/**
 * Fetch every deposit + borrow + withdraw event on the pool contract,
 * decrypt the memos addressed to `identity`, and replace the local
 * note store with the combined inventory. Withdraw + repay events
 * mark their nullifiers so the matching deposit / borrow notes get
 * removed automatically.
 */
export async function scanShieldedNotes(
  identity: ScanIdentity,
  signal?: AbortSignal
): Promise<ShieldedNote[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) {
    console.warn("[scanner] no contract id configured — skipping scan")
    replaceNotes([])
    return []
  }
  console.log(
    "[scanner] starting",
    JSON.stringify({
      contract: contractId,
      identityPkPrefix: Array.from(identity.publicKey.slice(0, 4)).map((b) =>
        b.toString(16).padStart(2, "0")
      ).join(""),
    })
  )

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const withdrawTopic = sdk.xdr.ScVal.scvSymbol("withdraw").toXDR("base64")
  const repayTopic = sdk.xdr.ScVal.scvSymbol("repay").toXDR("base64")
  const liquidateTopic = sdk.xdr.ScVal.scvSymbol("liquidat").toXDR("base64")

  // Soroban `getEvents` treats a filter's topic array as an EXACT
  // slot-count match — `[[T]]` only matches events whose topic list
  // has length 1. Our contract emits 2 topics for deposit / borrow /
  // repay (`(topic, asset)`) and 3 for withdraw + liquidate
  // (`(topic, asset, tree_kind)`). Widen to cover both.
  // Soroban RPC caps `filters` at 5 entries per request. We need 6:
  // deposit (2-slot), borrow (3-slot), withdraw (2-slot),
  // withdraw-loan (3-slot), repay (2-slot), liquidate (2-slot).
  // Split into two calls + merge.
  const filtersA = [
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[depositTopic, "*"]],
    },
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[borrowTopic, "*", "*"]],
    },
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[withdrawTopic, "*"]],
    },
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[withdrawTopic, "*", "*"]],
    },
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[repayTopic, "*"]],
    },
  ]
  const filtersB = [
    {
      type: "contract" as const,
      contractIds: [contractId],
      topics: [[liquidateTopic, "*"]],
    },
  ]

  let response: unknown
  try {
    console.log(
      "[scanner] getEvents startLedger=",
      startLedger,
      "filtersA=",
      JSON.stringify(filtersA)
    )
    const [respA, respB] = await Promise.all([
      server.getEvents({ filters: filtersA, startLedger, limit: 500 }),
      server.getEvents({ filters: filtersB, startLedger, limit: 500 }),
    ])
    console.log(
      "[scanner] fetch A=",
      ((respA as { events?: unknown[] }).events ?? []).length,
      "B=",
      ((respB as { events?: unknown[] }).events ?? []).length
    )
    const eventsA = (respA as { events?: unknown[] }).events ?? []
    const eventsB = (respB as { events?: unknown[] }).events ?? []
    response = { events: [...eventsA, ...eventsB] }
  } catch (err) {
    console.error("[scanner] getEvents threw", err)
    replaceNotes([])
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  console.log("[scanner] events fetched:", events.length)
  const notes: ShieldedNote[] = []
  const spentNullifiers = new Set<bigint>()

  // Legacy compatibility: notes deposited before commit `2f789df`
  // were encrypted to a double-derived identity
  // (`deriveShieldedIdentity(identity.secretKey)`). Try the current
  // identity first; if that fails, try the legacy derivation. Old
  // notes materialise with their legacy `sk` so subsequent spend
  // paths (withdraw / repay) reproduce the same nullifier the
  // original circuit did.
  const legacyIdentity = deriveShieldedIdentity(identity.secretKey)
  const legacySkField = uintToBigint(legacyIdentity.secretKey)

  for (const event of events) {
    const topic = decodeTopicSymbol(sdk, event)
    if (topic === "withdraw") {
      const nullifier = decodeWithdrawNullifier(sdk, event)
      if (nullifier !== null) spentNullifiers.add(nullifier)
      continue
    }
    if (topic === "repay") {
      for (const n of decodeRepayNullifiers(sdk, event)) {
        spentNullifiers.add(n)
      }
      continue
    }
    if (topic === "liquidat") {
      const nullifier = decodeLiquidateNullifier(sdk, event)
      if (nullifier !== null) spentNullifiers.add(nullifier)
      continue
    }
    if (topic !== "deposit" && topic !== "borrow") continue

    // Borrow events carry the four spent collateral nullifiers after
    // the memo — pull them out so deposit notes drop out of the local
    // cache next time round.
    if (topic === "borrow") {
      for (const n of decodeBorrowSpentNullifiers(sdk, event)) {
        spentNullifiers.add(n)
      }
    }

    const decoded = decodeIndexedEvent(sdk, event)
    if (!decoded) continue

    let plaintext = tryDecryptAnyMemo({
      raw: decoded.memo,
      recipientSk: identity.secretKey,
    })
    let skForNote = identity.skField
    let usedLegacy = false
    if (!plaintext) {
      plaintext = tryDecryptAnyMemo({
        raw: decoded.memo,
        recipientSk: legacyIdentity.secretKey,
      })
      if (plaintext) {
        skForNote = legacySkField
        usedLegacy = true
      }
    }
    if (!plaintext) continue
    if (topic === "deposit") {
      const asset = plaintext.asset as ShieldedAsset
      const computedCommitment =
        (SUPPORTED_ASSETS as readonly string[]).includes(asset)
          ? computeCommitment({
              amount: DENOMINATION[asset],
              asset,
              salt: BigInt(plaintext.salt),
              sk: skForNote,
            }).toString()
          : "n/a"
      console.log(
        "[scanner] deposit note",
        JSON.stringify({
          index: decoded.index,
          asset: plaintext.asset,
          usedLegacy,
          computedCommitment,
        })
      )
    }

    const asset = plaintext.asset as ShieldedAsset
    if (!(SUPPORTED_ASSETS as readonly string[]).includes(asset)) continue

    const openedAt = eventOpenedAt(event)
    if (topic === "deposit") {
      notes.push({
        amount: DENOMINATION[asset],
        asset,
        index: decoded.index,
        openedAt,
        salt: BigInt(plaintext.salt),
        sk: skForNote,
        tree: "deposit",
      })
    } else {
      // Borrow memos carry the freshly minted loan-note amount
      // (client-side derived from oracle price × collateral × LTV).
      // Falls back to the denomination if amount is missing.
      const amount =
        typeof plaintext.amount === "string" && plaintext.amount.length > 0
          ? BigInt(plaintext.amount)
          : DENOMINATION[asset]
      const bondCollateralAsset =
        typeof plaintext.bond?.collateralAsset === "string" &&
        (SUPPORTED_ASSETS as readonly string[]).includes(
          plaintext.bond.collateralAsset
        )
          ? (plaintext.bond.collateralAsset as ShieldedAsset)
          : undefined
      const bond = plaintext.bond
        ? {
            saltAmount: BigInt(plaintext.bond.saltAmount),
            saltValue: BigInt(plaintext.bond.saltValue),
            saltPrice: BigInt(plaintext.bond.saltPrice),
            collateralValue: BigInt(plaintext.bond.collateralValue),
            borrowPrice: BigInt(plaintext.bond.oraclePrice),
            collateralAsset: bondCollateralAsset,
          }
        : undefined
      notes.push({
        amount,
        asset,
        bond,
        index: decoded.index,
        openedAt,
        salt: BigInt(plaintext.salt),
        sk: skForNote,
        tree: "loan",
      })
    }
  }

  const deduped = dedupeNotes(notes)
  // Consult the contract's `nullifiers_used` view for every deposit
  // note we can see — catches nullifiers spent by borrow events that
  // predate the borrow-event nullifier-tail upgrade (which don't
  // publish the four nullifiers in their event body). One bulk RPC
  // per rescan.
  await hydrateSpentFromChain(deduped, spentNullifiers)
  const live = filterSpentNotes(deduped, spentNullifiers)

  // Merge with prior cache so:
  //   1. Scan-rebuilt notes inherit any Merkle inclusion witness that
  //      `prepareDeposit` pinned at mint-time — the scanner only sees
  //      event topics + memos, not Merkle state.
  //   2. Cache notes not present in this scan are kept ONLY when they
  //      still carry a witness, still have a positive amount (skip
  //      the local spent tombstones useBorrow writes on success),
  //      AND their nullifier hasn't appeared in the spent set. Soroban
  //      RPC lags a few seconds behind the ledger, so a note minted
  //      just before this rescan may not surface yet — dropping it
  //      would strand a fresh deposit between `useDeposit`'s upsert
  //      and the next-tick rescan, mid-flow.
  const previous = snapshotNotes()
  const seen = new Set(
    live.map((n) => `${n.asset}:${n.tree}:${n.index}`)
  )
  const withWitness = live.map((note) => {
    if (note.witness) return note
    const carry = previous.find(
      (p) =>
        p.tree === note.tree &&
        p.index === note.index &&
        p.asset === note.asset &&
        p.amount === note.amount &&
        p.sk === note.sk &&
        p.witness
    )
    return carry ? { ...note, witness: carry.witness } : note
  })
  const carriedOver = previous.filter((p) => {
    if (!p.witness) return false
    if (p.amount <= 0n) return false
    if (seen.has(`${p.asset}:${p.tree}:${p.index}`)) return false
    if (p.tree === "deposit") {
      const nullifier = computeNullifier(p.sk, p.index)
      if (spentNullifiers.has(nullifier)) return false
    }
    return true
  })
  const merged = [...withWitness, ...carriedOver]
  merged.sort((a, b) => b.index - a.index)
  console.log(
    "[scanner] done",
    JSON.stringify({
      decrypted: notes.length,
      deduped: deduped.length,
      live: live.length,
      carriedOver: carriedOver.length,
      preservedWitnesses: merged.filter((n) => n.witness).length,
      spentNullifiers: spentNullifiers.size,
    })
  )
  replaceNotes(merged)
  return merged
}

/**
 * Query the contract's `nullifiers_used` view once per deposit note
 * we surfaced and drop the ones already flagged spent. Covers borrow
 * events that predate the nullifier-tail upgrade (whose bodies didn't
 * carry the four spent nullifiers publicly).
 */
async function hydrateSpentFromChain(
  notes: ShieldedNote[],
  spentNullifiers: Set<bigint>
): Promise<void> {
  const contractId = getConfiguredContractId()
  if (!contractId) return
  const candidates = notes.filter((n) => n.tree === "deposit")
  if (candidates.length === 0) return
  try {
    const bindings = await import("@/features/protocol/bindings/borrow-pool")
    const sdkForPk = await import("@stellar/stellar-sdk")
    const client = new bindings.Client({
      contractId,
      networkPassphrase: getConfiguredNetworkPassphrase(),
      rpcUrl: getConfiguredSorobanRpcUrl(),
      publicKey: sdkForPk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32)),
    })
    const nullifiers = candidates.map((n) => computeNullifier(n.sk, n.index))
    const nulBuffers = nullifiers.map((n) => Buffer.from(bigintTo32BytesBE(n)))
    const tx = await client.nullifiers_used({ nullifiers: nulBuffers })
    const flags = (tx.result ?? []) as boolean[]
    let flagged = 0
    for (let i = 0; i < flags.length; i++) {
      if (flags[i]) {
        spentNullifiers.add(nullifiers[i])
        flagged++
      }
    }
    console.log("[scanner] hydrate", {
      queried: candidates.length,
      flaggedSpent: flagged,
    })
  } catch (cause) {
    // Surface the failure loudly so a UI regression doesn't silently
    // treat spent notes as spendable. The scan itself still returns;
    // only the pre-upgrade fallback path is unavailable this round.
    console.error(
      "[scanner] hydrate failed",
      cause instanceof Error ? cause.message : cause
    )
  }
}

function bigintTo32BytesBE(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let v = value
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

/**
 * getEvents pagination can echo the same event across two calls if
 * ledgers close near the page boundary. `${tree}:${index}` is unique
 * per note within an asset; drop the second sighting so `replaceNotes`
 * never propagates a phantom balance.
 */
export function dedupeNotes(notes: ShieldedNote[]): ShieldedNote[] {
  const seen = new Set<string>()
  const out: ShieldedNote[] = []
  for (const note of notes) {
    const key = `${note.asset}:${note.tree}:${note.index}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(note)
  }
  return out
}

function decodeWithdrawNullifier(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 1) return null
  const raw = native[0]
  if (raw instanceof Uint8Array) return uintToBigint(raw)
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return uintToBigint(bytes)
  }
  return null
}

function decodeLiquidateNullifier(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  // Contract emits (loan_commit, nullifier, liquidator). Nullifier is
  // the second entry.
  if (!Array.isArray(native) || native.length < 2) return null
  return rawToBigInt(native[1])
}

function decodeRepayNullifiers(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint[] {
  const value = toScVal(sdk, event.value)
  if (!value) return []
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return []
  }
  if (!Array.isArray(native) || native.length < 2) return []
  const out: bigint[] = []
  for (let i = 0; i < 2; i++) {
    const raw = native[i]
    const n = rawToBigInt(raw)
    if (n !== null) out.push(n)
  }
  return out
}

function rawToBigInt(raw: unknown): bigint | null {
  if (raw instanceof Uint8Array) return uintToBigint(raw)
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return uintToBigint(bytes)
  }
  return null
}

function uintToBigint(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function decodeTopicSymbol(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): string | null {
  const list =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  if (list.length === 0) return null
  const first = toScVal(sdk, list[0])
  if (!first) return null
  try {
    const native = sdk.scValToNative(first)
    return typeof native === "string" ? native : null
  } catch {
    return null
  }
}

function extractEvents(response: unknown): RpcEvent[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as RpcEvent[]) : []
}

function decodeIndexedEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): { index: number; memo: Uint8Array } | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null

  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native)) return null

  // Event body shapes accepted:
  //   deposit / repay-back: (index, root, leaf, memo)
  //   borrow post-upgrade:  (index, root, leaf, memo, n0, n1, n2, n3)
  //   legacy:               (index, memo)
  let rawIndex: unknown
  let rawMemo: unknown
  if (native.length === 4 || native.length === 8) {
    rawIndex = native[0]
    rawMemo = native[3]
  } else if (native.length === 2) {
    rawIndex = native[0]
    rawMemo = native[1]
  } else {
    return null
  }

  const index =
    typeof rawIndex === "bigint" ? Number(rawIndex) : Number(rawIndex ?? -1)
  if (!Number.isFinite(index) || index < 0) return null

  const memo = memoBytes(rawMemo)
  if (!memo) return null

  return { index, memo }
}

/**
 * Extract the four collateral-note nullifiers from a borrow event
 * body. Returns an empty array for pre-upgrade events (which didn't
 * carry the nullifier tail).
 */
function decodeBorrowSpentNullifiers(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint[] {
  const value = toScVal(sdk, event.value)
  if (!value) return []
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return []
  }
  if (!Array.isArray(native) || native.length !== 8) return []
  const out: bigint[] = []
  for (let i = 4; i < 8; i++) {
    const bytes = memoBytes(native[i])
    if (!bytes) continue
    let v = 0n
    for (const b of bytes) v = (v << 8n) | BigInt(b)
    out.push(v)
  }
  return out
}

function memoBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const out = new Uint8Array(arr.length)
    for (let index = 0; index < arr.length; index++) out[index] = arr[index]
    return out
  }
  return null
}

function toScVal(
  sdk: typeof import("@stellar/stellar-sdk"),
  value: unknown
): InstanceType<typeof sdk.xdr.ScVal> | null {
  if (typeof value === "string") {
    try {
      return sdk.xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && "toXDR" in value) {
    return value as InstanceType<typeof sdk.xdr.ScVal>
  }
  return null
}
