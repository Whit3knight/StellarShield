// Scans deposit / borrow / repay events on the borrow-pool contract,
// tries to decrypt each attached memo with the wallet's shielded
// identity, and rebuilds the user's note inventory. Runs on wallet
// connect and whenever a new confirmation lands via the borrow-events
// bus, so notes survive fresh browsers / cleared localStorage while
// events are still within RPC retention.
//
// Event layout (matches contracts/borrow-pool/src/lib.rs). Topic slot 1
// always carries the asset, and it is the ONLY thing that tells us which
// nullifier namespace a spend belongs to:
//   ("deposit",  asset)                          -> (index, root, leaf, memo)
//   ("borrow",   collateralAsset, borrowAsset)   -> (index, root, leaf, memo, n0..n3)
//   ("withdraw", asset)                          -> (nullifier, to)
//   ("withdraw", asset, "loan")                  -> (nullifier, to, amount)
//   ("repay",    asset)                          -> (loanNullifier, depositNullifier, from)
//   ("liquidat", borrowAsset)                    -> (loanCommit, loanNullifier, liquidator)
// A borrow's four nullifiers burn DEPOSIT notes in the COLLATERAL asset
// (topic 1) while the loan note it mints lives in the borrow asset.

import { deriveShieldedIdentity, tryDecryptAnyMemo } from "./memo"
import {
  DENOMINATION,
  SUPPORTED_ASSETS,
  computeCommitment,
  computeNullifier,
  isSpentNote,
  type NoteTree,
  type ShieldedAsset,
  type ShieldedNote,
} from "./note"
import { replaceNotes, snapshotNotes } from "./note-store"
import { fetchAllContractEvents, type RpcEvent } from "./rpc-events"

import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

export function eventOpenedAt(event: {
  ledgerClosedAt?: string
}): number | undefined {
  if (!event.ledgerClosedAt) return undefined
  const ms = Date.parse(event.ledgerClosedAt)
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}

/**
 * Key for the local spent-nullifier set, mirroring the contract's
 * storage key `(tree, asset, nullifier)`. `nullifier = Poseidon(sk,
 * leaf_index)` has no tree or asset domain separation and leaf counters
 * restart per (tree, asset) on chain, so XLM deposit #0 and USDC
 * deposit #0 are the SAME bytes. Matching on the bare value lets one
 * asset's spend tombstone another asset's live note — permanently,
 * since `markSpentNotes` only ever sets `spent` and the store persists
 * it.
 */
export function spentKey(
  asset: ShieldedAsset,
  tree: NoteTree,
  nullifier: bigint
): string {
  return `${asset}:${tree}:${nullifier}`
}

/**
 * Flag notes whose (asset, tree, nullifier) appears in `spent`. Spent
 * notes are kept as tombstones (not dropped) because their commitments
 * backfill Merkle rebuilds once the enabling events roll off RPC
 * retention. Pure so it can be exercised without spinning up an rpc
 * mock.
 */
export function markSpentNotes<
  T extends {
    sk: bigint
    index: number
    asset: ShieldedAsset
    tree: NoteTree
    spent?: boolean
  }
>(notes: T[], spent: Set<string>): (T & { spent?: boolean })[] {
  return notes.map((note) =>
    spent.has(
      spentKey(note.asset, note.tree, computeNullifier(note.sk, note.index))
    ) && note.spent !== true
      ? { ...note, spent: true }
      : note
  )
}

/**
 * Previous-cache notes not surfaced by this scan pass. Kept so a
 * persisted inventory (localStorage) survives events
 * expiring from RPC retention; notes whose nullifier is now spent are
 * tombstoned instead of dropped.
 */
export function carryOverNotes(
  previous: ShieldedNote[],
  seen: Set<string>,
  spentNullifiers: Set<string>
): ShieldedNote[] {
  return markSpentNotes(
    previous.filter((p) => !seen.has(`${p.asset}:${p.tree}:${p.index}`)),
    spentNullifiers
  )
}

export type ScanIdentity = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  skField: bigint
}

/**
 * Fetch every deposit + borrow + withdraw event on the pool contract,
 * decrypt the memos addressed to `identity`, and merge the result into
 * the local note store. Withdraw + repay events mark their nullifiers
 * so the matching deposit / borrow notes get tombstoned (`spent`)
 * automatically; previously known notes the scan can no longer see
 * are carried over rather than dropped.
 */
export async function scanShieldedNotes(
  identity: ScanIdentity,
  legacyIdentities: ScanIdentity[] = [],
  signal?: AbortSignal
): Promise<ShieldedNote[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) {
    console.warn("[scanner] no contract id configured — skipping scan")
    return snapshotNotes()
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
  const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const withdrawTopic = sdk.xdr.ScVal.scvSymbol("withdraw").toXDR("base64")
  const repayTopic = sdk.xdr.ScVal.scvSymbol("repay").toXDR("base64")
  const liquidateTopic = sdk.xdr.ScVal.scvSymbol("liquidat").toXDR("base64")

  // Soroban `getEvents` treats a filter's topic array as an EXACT
  // slot-count match — `[[T]]` only matches events whose topic list
  // has length 1. Per the layout at the top of this file, deposit /
  // withdraw / repay / liquidate emit 2 topics (`(topic, asset)`),
  // while borrow emits 3 (`(topic, collateralAsset, borrowAsset)`) and
  // withdraw's loan variant emits 3 (`(topic, asset, "loan")`). Widen
  // to cover both slot counts.
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

  let events: RpcEvent[]
  let indexerDown: string | null = null
  const onIndexerDown = (reason: string) => {
    indexerDown ??= reason
  }
  try {
    const [eventsA, eventsB] = await Promise.all([
      fetchAllContractEvents({
        server,
        filters: filtersA,
        signal,
        onIndexerDown,
      }),
      fetchAllContractEvents({
        server,
        filters: filtersB,
        signal,
        onIndexerDown,
      }),
    ])
    console.log("[scanner] fetch A=", eventsA.length, "B=", eventsB.length)
    events = [...eventsA, ...eventsB]
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    console.error("[scanner] getEvents threw", err)
    return snapshotNotes()
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  console.log("[scanner] events fetched:", events.length)
  const notes: ShieldedNote[] = []
  const spentNullifiers = new Set<string>()

  // Trial-decrypt each memo against every identity that could have
  // minted a note for this wallet, newest scheme first:
  //   - the current (v2, signature-derived) identity;
  //   - any legacy identities (R1: the pre-migration address-derived
  //     identity, so notes minted before the signature scheme still
  //     decrypt and spend);
  //   - and each one's double-derivation, for notes deposited before
  //     commit `2f789df`.
  // A note materialises with the `sk` of whichever identity decrypted
  // it, so its spend path (withdraw / repay) reproduces the same
  // nullifier the original mint circuit did.
  const trialIdentities: { secretKey: Uint8Array; skField: bigint }[] = []
  for (const id of [identity, ...legacyIdentities]) {
    trialIdentities.push({ secretKey: id.secretKey, skField: id.skField })
    const doubled = deriveShieldedIdentity(id.secretKey)
    trialIdentities.push({
      secretKey: doubled.secretKey,
      skField: uintToBigint(doubled.secretKey),
    })
  }

  for (const event of events) {
    const topics = decodeTopicSymbols(sdk, event)
    const topic = topics[0]
    // Topic slot 1 is the asset on every event the contract emits, and
    // it is what scopes the spend. An event whose asset topic we cannot
    // read is skipped rather than attributed to a guess: an unscoped
    // nullifier would tombstone the same leaf index in every asset.
    // `hydrateSpentFromChain` still catches such a spend on the
    // authoritative per-(tree, asset) contract read below.
    const topicAsset = shieldedAsset(topics[1])
    if (topic === "withdraw") {
      // ("withdraw", asset) burns a deposit note; the loan-tree variant
      // appends a third topic, Symbol "loan".
      const nullifier = decodeWithdrawNullifier(sdk, event)
      if (nullifier !== null && topicAsset) {
        const tree: NoteTree = topics[2] === "loan" ? "loan" : "deposit"
        spentNullifiers.add(spentKey(topicAsset, tree, nullifier))
      }
      continue
    }
    if (topic === "repay") {
      // Body is (loanNullifier, depositNullifier, from): one note burned
      // in each tree, both in the topic's asset.
      const { loan, deposit } = decodeRepayNullifiers(sdk, event)
      if (topicAsset) {
        if (loan !== null) spentNullifiers.add(spentKey(topicAsset, "loan", loan))
        if (deposit !== null) {
          spentNullifiers.add(spentKey(topicAsset, "deposit", deposit))
        }
      }
      continue
    }
    if (topic === "liquidat") {
      // ("liquidat", borrowAsset) — burns the loan note in that asset.
      const nullifier = decodeLiquidateNullifier(sdk, event)
      if (nullifier !== null && topicAsset) {
        spentNullifiers.add(spentKey(topicAsset, "loan", nullifier))
      }
      continue
    }
    if (topic !== "deposit" && topic !== "borrow") continue

    // Borrow events carry the four spent collateral nullifiers after
    // the memo — pull them out so deposit notes drop out of the local
    // cache next time round. They burn DEPOSIT notes in the COLLATERAL
    // asset (topic 1), not in the borrow asset the loan note below gets.
    if (topic === "borrow") {
      if (topicAsset) {
        for (const n of decodeBorrowSpentNullifiers(sdk, event)) {
          spentNullifiers.add(spentKey(topicAsset, "deposit", n))
        }
      }
    }

    const decoded = decodeIndexedEvent(sdk, event)
    if (!decoded) continue

    let plaintext: ReturnType<typeof tryDecryptAnyMemo> = null
    let skForNote = identity.skField
    let usedLegacy = false
    for (let i = 0; i < trialIdentities.length; i++) {
      const trial = trialIdentities[i]
      const decryptedMemo = tryDecryptAnyMemo({
        raw: decoded.memo,
        recipientSk: trial.secretKey,
      })
      if (decryptedMemo) {
        plaintext = decryptedMemo
        skForNote = trial.skField
        usedLegacy = i > 0 // index 0 is the current identity
        break
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
  // Consult the contract's per-tree spent-nullifier views for every
  // note we can see — scan-surfaced AND carried-over from the
  // persisted store. Once the enabling events expire from RPC
  // retention, this contract read is the only way a carried-over
  // note's spend ever becomes visible; hydrating only scan results
  // would leave persisted notes spendable-looking forever.
  await hydrateSpentFromChain(
    dedupeNotes([...deduped, ...snapshotNotes()]),
    spentNullifiers
  )
  const marked = markSpentNotes(deduped, spentNullifiers)

  // Merge with prior cache so:
  //   1. Scan-rebuilt notes inherit any Merkle inclusion witness that
  //      `prepareDeposit` pinned at mint-time — the scanner only sees
  //      event topics + memos, not Merkle state.
  //   2. Cache notes not present in this scan are kept (persisted /
  //      restored notes outlive RPC retention; a just-minted note may
  //      lag the RPC event index by a few seconds). Ones whose
  //      nullifier appears in the spent set become tombstones instead
  //      of being dropped.
  const previous = snapshotNotes()
  const seen = new Set(
    marked.map((n) => `${n.asset}:${n.tree}:${n.index}`)
  )
  const withWitness = marked.map((note) => {
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
  const carriedOver = carryOverNotes(previous, seen, spentNullifiers)
  const merged = [...withWitness, ...carriedOver]
  merged.sort((a, b) => b.index - a.index)
  console.log(
    "[scanner] done",
    JSON.stringify({
      decrypted: notes.length,
      deduped: deduped.length,
      live: merged.filter((n) => !isSpentNote(n)).length,
      carriedOver: carriedOver.length,
      preservedWitnesses: merged.filter((n) => n.witness).length,
      spentNullifiers: spentNullifiers.size,
    })
  )
  replaceNotes(merged)
  // Fire-and-forget: a warning must never delay or fail the scan.
  if (indexerDown) {
    void warnRpcOnlyScan(merged, indexerDown).catch((cause) =>
      console.warn("[scanner] could not raise RPC-only warning", cause)
    )
  }
  return merged
}

/**
 * Soroban RPC retains events ~7 days. Past that the indexer is the only
 * source that can re-derive a note's opening, so a note older than this
 * is one an RPC-only scan can no longer rebuild.
 */
const RPC_RETENTION_SECONDS = 7 * 24 * 60 * 60

/**
 * Live notes whose mint event has aged out of the RPC window — exactly
 * the ones this scan could not have rebuilt from RPC alone. Spent
 * tombstones are excluded (nobody's funds ride on them) and so are
 * notes with an unknown `openedAt`: counting those would fire the
 * warning on scans where nothing is actually at risk, and a warning
 * the user learns to ignore is worse than none.
 */
export function notesBeyondRpcRetention(
  notes: ShieldedNote[],
  nowSeconds = Math.floor(Date.now() / 1000)
): ShieldedNote[] {
  const cutoff = nowSeconds - RPC_RETENTION_SECONDS
  return notes.filter(
    (note) =>
      !isSpentNote(note) && note.openedAt !== undefined && note.openedAt < cutoff
  )
}

// ponytail: once per page load, not per scan — the scanner re-runs on
// every confirmation and a repeated modal-level warning is how users
// learn to dismiss it unread. Upgrade path if this ever needs to
// re-arm: reset on wallet change.
let warnedRpcOnlyScan = false

/**
 * The dangerous combination: this scan ran without the indexer AND the
 * user holds notes older than RPC retention. Either alone is fine —
 * RPC-only is the documented fallback, and old notes are safe while the
 * indexer answers — so only the intersection is worth a toast.
 */
async function warnRpcOnlyScan(
  notes: ShieldedNote[],
  reason: string
): Promise<void> {
  const beyond = notesBeyondRpcRetention(notes)
  console.warn("[scanner] indexer down — RPC-only scan", {
    reason,
    notesBeyondRetention: beyond.length,
  })
  // The scanner is importable from node scripts (features/notes/index.ts);
  // there is no toast host there.
  if (beyond.length === 0 || warnedRpcOnlyScan || typeof window === "undefined") {
    return
  }
  warnedRpcOnlyScan = true
  const { toastManager } = await import("@/components/ui/toast")
  toastManager.add({
    title: "Scanned without the event indexer",
    description:
      `${beyond.length} of your notes ${beyond.length === 1 ? "is" : "are"} ` +
      `older than the ~7-day RPC event window, so this scan could not ` +
      `re-derive ${beyond.length === 1 ? "it" : "them"} from chain events — ` +
      `only from this browser's stored notes. They stay spendable here, but ` +
      `clearing this browser's storage before the indexer is back would ` +
      `strand them.`,
    type: "warning",
  })
}

/**
 * Compute each note's nullifier and bucket it by (tree, asset) — one
 * bucket per contract nullifier namespace. `nullifier =
 * Poseidon(sk, leaf_index)` has no tree or asset domain separation, so
 * the SAME bytes recur at the same leaf index in each of the 6 trees;
 * only the storage key `(tree, asset, nullifier)` keeps them apart.
 * Querying a note against the wrong asset's namespace reports another
 * asset's spend as this note's.
 */
export function nullifiersByTreeAndAsset(
  notes: Array<Pick<ShieldedNote, "sk" | "index" | "tree" | "asset">>
): Array<{
  tree: ShieldedNote["tree"]
  asset: ShieldedAsset
  nullifiers: bigint[]
}> {
  const groups = new Map<
    string,
    { tree: ShieldedNote["tree"]; asset: ShieldedAsset; nullifiers: bigint[] }
  >()
  for (const n of notes) {
    const key = `${n.tree}:${n.asset}`
    let group = groups.get(key)
    if (!group) {
      group = { tree: n.tree, asset: n.asset, nullifiers: [] }
      groups.set(key, group)
    }
    group.nullifiers.push(computeNullifier(n.sk, n.index))
  }
  return [...groups.values()]
}

/**
 * Query the contract's spent-nullifier views for every note we hold.
 * Deposit notes go to `nullifiers_used`, loan notes to
 * `loan_nullifiers_used`, each scoped to the note's asset — the
 * contract keeps one namespace per (tree, asset), so nullifiers that
 * share bytes across trees or across assets no longer collide. One
 * call per (tree, asset) group. These bulk reads mark claimed loans
 * and repaid/withdrawn deposits spent even when the recording events
 * are outside every event source.
 */
async function hydrateSpentFromChain(
  notes: ShieldedNote[],
  spentNullifiers: Set<string>
): Promise<void> {
  const contractId = getConfiguredContractId()
  if (!contractId) return
  const candidates = notes
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
    let flagged = 0
    for (const { tree, asset, nullifiers } of nullifiersByTreeAndAsset(
      candidates
    )) {
      const nulBuffers = nullifiers.map((n) =>
        Buffer.from(bigintTo32BytesBE(n))
      )
      const tx =
        tree === "deposit"
          ? await client.nullifiers_used({ asset, nullifiers: nulBuffers })
          : await client.loan_nullifiers_used({ asset, nullifiers: nulBuffers })
      const flags = (tx.result ?? []) as boolean[]
      for (let i = 0; i < flags.length; i++) {
        if (flags[i]) {
          // Keep the namespace the query was scoped to — flattening it
          // back to a bare value is what let one asset's spend mark
          // another asset's note.
          spentNullifiers.add(spentKey(asset, tree, nullifiers[i]))
          flagged++
        }
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

/**
 * Repay body is `(loan_nullifier, deposit_nullifier, from)`. Returned
 * positionally, not as a list: the two burn notes in DIFFERENT trees, so
 * losing which slot a value came from loses its namespace.
 */
function decodeRepayNullifiers(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): { loan: bigint | null; deposit: bigint | null } {
  const none = { loan: null, deposit: null }
  const value = toScVal(sdk, event.value)
  if (!value) return none
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return none
  }
  if (!Array.isArray(native) || native.length < 2) return none
  return { loan: rawToBigInt(native[0]), deposit: rawToBigInt(native[1]) }
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

/**
 * Every topic slot decoded as a Symbol string, positionally (`null`
 * where a slot is absent or not a symbol). Slot 0 is the event name and
 * slot 1 the asset that scopes its nullifiers, so the scanner needs the
 * whole list, not just the head.
 */
function decodeTopicSymbols(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): (string | null)[] {
  const list =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  return list.map((slot) => {
    const val = toScVal(sdk, slot)
    if (!val) return null
    try {
      const native = sdk.scValToNative(val)
      return typeof native === "string" ? native : null
    } catch {
      return null
    }
  })
}

function shieldedAsset(value: string | null | undefined): ShieldedAsset | null {
  return value && (SUPPORTED_ASSETS as readonly string[]).includes(value)
    ? (value as ShieldedAsset)
    : null
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
