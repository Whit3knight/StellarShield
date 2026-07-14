// Rebuilds a shielded tree (deposit or loan) and produces inclusion
// witnesses. The contract stores only the current root + frontier +
// next_index, so any spend prover has to reconstruct the tree
// client-side to derive path_elements + path_bits.
//
// Leaves come from event replay over the full RPC retention window
// (cursor-paginated), backfilled with commitments recomputed from the
// user's own notes for events that expired past retention. The
// rebuilt root is checked against the on-chain root before any
// witness is handed out.

import {
  computeCommitment,
  DENOMINATION,
  DEPTH,
  snapshotNotes,
  verifyInclusion,
  zeroHashes,
  type NoteTree,
} from "@/features/notes"
import { poseidon } from "@/features/notes/poseidon"
import {
  fetchAllContractEvents,
  type RpcEvent,
} from "@/features/notes/rpc-events"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

export type WithdrawWitness = {
  leaf: bigint
  leafIndex: number
  pathBits: number[]
  pathElements: bigint[]
  root: bigint
}

type IndexedLeaf = { index: number; leaf: bigint }

/**
 * Fetch every borrow event for `asset` and rebuild the loan tree to
 * produce inclusion witnesses for each borrower's loan note. Same
 * shape as `fetchDepositWitnesses` but scans the ("borrow", ...)
 * topic and reads the leaf out of the emitted event body.
 */
export async function fetchLoanWitnesses(
  borrowAsset: string,
  signal?: AbortSignal,
  wantedIndices?: Set<number>
): Promise<WithdrawWitness[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const sdk = await import("@stellar/stellar-sdk")
  const server = new sdk.rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })

  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const events = await fetchAllContractEvents({
    server,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
        topics: [[borrowTopic, "*", "*"]],
      },
    ],
    signal,
  })
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  // Borrow events carry the borrow_asset symbol as the third topic —
  // filter here so multi-market users only see the tree they need.
  const eventLeaves: IndexedLeaf[] = []
  for (const event of events) {
    const decoded = decodeBorrowEvent(sdk, event, borrowAsset)
    if (!decoded) continue
    eventLeaves.push(decoded)
  }

  return buildTreeWitnesses(
    contractId,
    borrowAsset,
    "loan",
    eventLeaves,
    wantedIndices
  )
}

/**
 * Fetch every deposit event for `asset` and rebuild the local merkle
 * tree state. Returns each leaf's inclusion witness so a caller can
 * pick the one that matches its note.
 */
export async function fetchDepositWitnesses(
  asset: string,
  signal?: AbortSignal,
  wantedIndices?: Set<number>
): Promise<WithdrawWitness[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const sdk = await import("@stellar/stellar-sdk")
  const server = new sdk.rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })

  const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
  const assetTopic = sdk.xdr.ScVal.scvSymbol(asset).toXDR("base64")
  const events = await fetchAllContractEvents({
    server,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
        topics: [[depositTopic, assetTopic]],
      },
    ],
    signal,
  })
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const eventLeaves: IndexedLeaf[] = []
  for (const event of events) {
    const decoded = decodeDepositEvent(sdk, event)
    if (!decoded) continue
    eventLeaves.push(decoded)
  }

  return buildTreeWitnesses(
    contractId,
    asset,
    "deposit",
    eventLeaves,
    wantedIndices
  )
}

/**
 * Merge event replay with locally held notes, check against the
 * on-chain state, and produce final-state witnesses. Throws instead
 * of silently returning a partial tree — every witness handed out is
 * verified against the contract's current root.
 */
async function buildTreeWitnesses(
  contractId: string,
  asset: string,
  tree: NoteTree,
  eventLeaves: IndexedLeaf[],
  wantedIndices?: Set<number>
): Promise<WithdrawWitness[]> {
  const { root: chainRoot, leafCount } = await readTreeState(
    contractId,
    asset,
    tree
  )
  if (leafCount === 0) return []

  const { leaves, gaps } = mergeLeaves(
    eventLeaves,
    ownNoteLeaves(asset, tree),
    leafCount
  )
  if (gaps.length > 0) {
    throw new Error(
      `${tree} events for leaf indices [${gaps.join(", ")}] expired from ` +
        `RPC retention and no local note covers them. Re-deposit to ` +
        `continue.`
    )
  }

  const witnesses = buildFinalStateWitnesses(leaves, wantedIndices)
  if (chainRoot !== null && witnesses[0]?.root !== chainRoot) {
    throw new Error(
      `${tree} tree root mismatch: locally rebuilt root does not match ` +
        `the on-chain root. Rescan notes and retry.`
    )
  }
  return witnesses
}

/**
 * Dense leaf array keyed by TRUE on-chain index. Event leaves are
 * authoritative (they carry what the contract actually appended) and
 * win conflicts; own-note commitments backfill events that expired
 * past RPC retention. Unresolvable holes come back as `gaps`.
 */
export function mergeLeaves(
  eventLeaves: IndexedLeaf[],
  ownLeaves: IndexedLeaf[],
  leafCount: number
): { leaves: bigint[]; gaps: number[] } {
  const slots = new Array<bigint | null>(leafCount).fill(null)
  for (const { index, leaf } of ownLeaves) {
    if (index >= 0 && index < leafCount) slots[index] = leaf
  }
  for (const { index, leaf } of eventLeaves) {
    if (index >= 0 && index < leafCount) slots[index] = leaf
  }
  const gaps: number[] = []
  for (let i = 0; i < leafCount; i++) {
    if (slots[i] === null) gaps.push(i)
  }
  return { leaves: slots.map((slot) => slot ?? 0n), gaps }
}

export function ownNoteLeaves(asset: string, tree: NoteTree): IndexedLeaf[] {
  // Spent notes stay in: their commitments still occupy tree slots and
  // are needed to rebuild the tree once their events expire from RPC
  // retention. Legacy deposit tombstones were zeroed in place, so
  // recompute their leaf at the fixed denomination.
  // ponytail: valid only because deposit notes are fixed-denomination;
  // on-chain root check is the safety net
  return snapshotNotes()
    .filter((n) => n.tree === tree && n.asset === asset)
    .map((n) => ({
      index: n.index,
      leaf: computeCommitment(
        n.tree === "deposit" && n.amount === 0n
          ? { ...n, amount: DENOMINATION[n.asset] }
          : n
      ),
    }))
}

async function readTreeState(
  contractId: string,
  asset: string,
  tree: NoteTree
): Promise<{ root: bigint | null; leafCount: number }> {
  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  const sdk = await import("@stellar/stellar-sdk")
  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32)),
  })
  const [rootTx, nextIndexTx] =
    tree === "deposit"
      ? await Promise.all([
          client.deposit_root({ asset }),
          client.deposit_next_index({ asset }),
        ])
      : await Promise.all([
          client.loan_root({ asset }),
          client.loan_next_index({ asset }),
        ])
  const rootBytes = rootTx.result
  return {
    root: rootBytes ? bytesToBigInt(rootBytes) : null,
    leafCount: Number(nextIndexTx.result ?? 0n),
  }
}

/**
 * Build the full sparse tree with `leaves` at positions 0..N-1, then
 * emit one witness per leaf using the FINAL tree state — every
 * witness carries the same `root`, which is what the borrow circuit
 * demands across its N=4 collateral inclusion checks.
 *
 * A naive per-append witness (root captured mid-tree-growth) drifts
 * away from later appends: the sibling of leaf 0 shifts from
 * `zeros[0]` to `leaves[1]` the moment leaf 1 lands, and the root
 * changes with it. This function walks the tree ONCE, then reads each
 * requested leaf's path against the completed state.
 *
 * `wantedIndices` limits the per-leaf witness emission (+ its 20-hash
 * inclusion verify) to the leaves the caller will actually spend —
 * the tree build itself is unchanged. Omitted = every leaf.
 */
export function buildFinalStateWitnesses(
  leaves: bigint[],
  wantedIndices?: Set<number>
): WithdrawWitness[] {
  const zeros = zeroHashes()

  // Sparse level rep: only the "populated" leftmost prefix at each
  // level is stored. Missing right-hand nodes are the zero-subtree
  // hash at that level.
  const levels: bigint[][] = []
  levels[0] = leaves.slice()
  for (let level = 0; level < DEPTH; level++) {
    const cur = levels[level]
    const next: bigint[] = []
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i]
      const right = i + 1 < cur.length ? cur[i + 1] : zeros[level]
      next.push(poseidon([left, right]))
    }
    levels[level + 1] = next
  }
  const root =
    levels[DEPTH].length > 0 ? levels[DEPTH][0] : zeros[DEPTH]

  const witnesses: WithdrawWitness[] = []
  for (let index = 0; index < leaves.length; index++) {
    if (wantedIndices && !wantedIndices.has(index)) continue
    const leaf = leaves[index]
    const path: bigint[] = []
    const pathBits: number[] = []
    for (let level = 0; level < DEPTH; level++) {
      const pos = index >> level
      const siblingPos = pos ^ 1
      const levelArr = levels[level]
      path.push(
        siblingPos < levelArr.length ? levelArr[siblingPos] : zeros[level]
      )
      pathBits.push(pos & 1)
    }
    if (!verifyInclusion({ leaf, leafIndex: index, path, root })) continue
    witnesses.push({
      leaf,
      leafIndex: index,
      pathBits,
      pathElements: path,
      root,
    })
  }
  return witnesses
}

function decodeBorrowEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent,
  expectedBorrowAsset: string
): IndexedLeaf | null {
  const topics =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  if (topics.length < 3) return null
  const borrowAsset = toScVal(sdk, topics[2])
  if (!borrowAsset) return null
  try {
    const native = sdk.scValToNative(borrowAsset)
    if (typeof native !== "string" || native !== expectedBorrowAsset) return null
  } catch {
    return null
  }

  const value = toScVal(sdk, event.value)
  if (!value) return null
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || (native.length !== 4 && native.length !== 8)) {
    return null
  }

  return nativeToIndexedLeaf(native[0], native[2])
}

function decodeDepositEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): IndexedLeaf | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null

  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length !== 4) return null

  return nativeToIndexedLeaf(native[0], native[2])
}

function nativeToIndexedLeaf(
  rawIndex: unknown,
  rawLeaf: unknown
): IndexedLeaf | null {
  const index =
    typeof rawIndex === "bigint" ? Number(rawIndex) : Number(rawIndex ?? -1)
  if (!Number.isFinite(index) || index < 0) return null

  const leaf = bytesToBigInt(rawLeaf)
  if (leaf === null) return null

  return { index, leaf }
}

function bytesToBigInt(raw: unknown): bigint | null {
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
