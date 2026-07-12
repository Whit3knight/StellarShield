// Rebuilds the shielded deposit tree from every ("deposit", asset)
// event and produces an inclusion witness for a given leaf. The
// contract stores only the current root + frontier + next_index, so
// any withdraw prover has to reconstruct the tree client-side to
// derive path_elements + path_bits.
//
// Cheap enough on testnet (a few thousand leaves per asset at most)
// that we recompute per withdraw. If usage grows the tree can be
// cached in note-store and appended incrementally.

import { append, DEPTH, verifyInclusion } from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

const LEDGER_LOOKBACK = 10_000

export type WithdrawWitness = {
  leaf: bigint
  leafIndex: number
  pathBits: number[]
  pathElements: bigint[]
  root: bigint
}

/**
 * Fetch every borrow event for `asset` and rebuild the loan tree to
 * produce inclusion witnesses for each borrower's loan note. Same
 * shape as `fetchDepositWitnesses` but scans the ("borrow", ...)
 * topic and reads the leaf out of the emitted event body.
 */
export async function fetchLoanWitnesses(
  borrowAsset: string,
  signal?: AbortSignal
): Promise<WithdrawWitness[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[borrowTopic, "*", "*"]],
        },
      ],
      startLedger,
      limit: 500,
    })
  } catch {
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  // Borrow events carry the borrow_asset symbol as the third topic —
  // filter here so multi-market users only see the tree they need.
  const relevant: { index: number; leaf: bigint }[] = []
  for (const event of events) {
    const decoded = decodeBorrowEvent(sdk, event, borrowAsset)
    if (!decoded) continue
    relevant.push(decoded)
  }
  relevant.sort((a, b) => a.index - b.index)

  const { append, DEPTH, verifyInclusion } = await import("@/features/notes")
  const frontier = new Array<bigint>(DEPTH).fill(0n)
  const witnesses: WithdrawWitness[] = []

  for (let idx = 0; idx < relevant.length; idx++) {
    const { leaf, index } = relevant[idx]
    if (index !== idx) continue
    const { path, root } = append({ frontier, leaf, nextIndex: index })
    const pathBits: number[] = []
    let cursor = index
    for (let level = 0; level < DEPTH; level++) {
      pathBits.push(cursor & 1)
      cursor >>= 1
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
): { index: number; leaf: bigint } | null {
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
  if (!Array.isArray(native) || native.length !== 4) return null

  const rawIndex = native[0]
  const rawLeaf = native[2]
  const index =
    typeof rawIndex === "bigint" ? Number(rawIndex) : Number(rawIndex ?? -1)
  if (!Number.isFinite(index) || index < 0) return null

  const leaf = bytesToBigInt(rawLeaf)
  if (leaf === null) return null

  return { index, leaf }
}

type RpcEvent = {
  contractId?: string
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
}

/**
 * Fetch every deposit event for `asset` in the retention window and
 * rebuild the local merkle tree state. Returns each leaf's inclusion
 * witness so a caller can pick the one that matches its note.
 */
export async function fetchDepositWitnesses(
  asset: string,
  signal?: AbortSignal
): Promise<WithdrawWitness[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
  const assetTopic = sdk.xdr.ScVal.scvSymbol(asset).toXDR("base64")

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[depositTopic, assetTopic]],
        },
      ],
      startLedger,
      limit: 500,
    })
  } catch {
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  const leaves: { index: number; leaf: bigint }[] = []

  for (const event of events) {
    const decoded = decodeDepositEvent(sdk, event)
    if (!decoded) continue
    leaves.push(decoded)
  }
  leaves.sort((a, b) => a.index - b.index)

  const frontier = new Array<bigint>(DEPTH).fill(0n)
  const witnesses: WithdrawWitness[] = []

  for (let idx = 0; idx < leaves.length; idx++) {
    const { leaf, index } = leaves[idx]
    // Trust `index` when contiguous with the append counter; if the
    // sequence is broken drop the witness rather than silently produce
    // a stale root.
    if (index !== idx) continue

    const { path, root } = append({ frontier, leaf, nextIndex: index })
    const pathBits: number[] = []
    let cursor = index
    for (let level = 0; level < DEPTH; level++) {
      pathBits.push(cursor & 1)
      cursor >>= 1
    }

    // Sanity: recompute inclusion from the derived path + root.
    if (!verifyInclusion({ leaf, leafIndex: index, path, root })) {
      continue
    }

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

function extractEvents(response: unknown): RpcEvent[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as RpcEvent[]) : []
}

function decodeDepositEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): { index: number; leaf: bigint } | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null

  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length !== 4) return null

  const rawIndex = native[0]
  const rawLeaf = native[2]
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
