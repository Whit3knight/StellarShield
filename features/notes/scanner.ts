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
  computeNullifier,
  type ShieldedAsset,
  type ShieldedNote,
} from "./note"
import { replaceNotes, snapshotNotes } from "./note-store"

import {
  getConfiguredContractId,
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

    const decoded = decodeIndexedEvent(sdk, event)
    if (!decoded) continue

    let plaintext = tryDecryptAnyMemo({
      raw: decoded.memo,
      recipientSk: identity.secretKey,
    })
    let skForNote = identity.skField
    if (!plaintext) {
      plaintext = tryDecryptAnyMemo({
        raw: decoded.memo,
        recipientSk: legacyIdentity.secretKey,
      })
      if (plaintext) skForNote = legacySkField
    }
    if (!plaintext) continue

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
  const live = filterSpentNotes(deduped, spentNullifiers)
  // Merge the Merkle inclusion witness cached at deposit-time onto
  // freshly scanned notes. `prepareDeposit` computes the path locally
  // before submitting the tx and stashes it on the note; scanner-
  // rebuilt notes don't carry it, so a raw replace strands every
  // spend behind an event-replay fallback that fails when Soroban RPC
  // hasn't finished indexing the enabling deposit yet.
  const previous = snapshotNotes()
  const merged = live.map((note) => {
    if (note.witness) return note
    const carry = previous.find(
      (p) =>
        p.tree === note.tree &&
        p.index === note.index &&
        p.asset === note.asset &&
        p.witness
    )
    return carry ? { ...note, witness: carry.witness } : note
  })
  merged.sort((a, b) => b.index - a.index)
  console.log(
    "[scanner] done",
    JSON.stringify({
      decrypted: notes.length,
      deduped: deduped.length,
      live: live.length,
      preservedWitnesses: merged.filter((n) => n.witness).length,
      spentNullifiers: spentNullifiers.size,
    })
  )
  replaceNotes(merged)
  return merged
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

  // Event body is (index, root, leaf, memo) after Phase 2 upgrade;
  // fall back to the legacy (index, memo) shape so pre-upgrade
  // events still decode until the retention window rolls over.
  let rawIndex: unknown
  let rawMemo: unknown
  if (native.length === 4) {
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
