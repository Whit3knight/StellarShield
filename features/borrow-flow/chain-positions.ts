import type { ChainBorrowReceipt } from "@/features/protocol"
import {
  getConfiguredContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Chain-derived borrow receipts. Reads `("borrow",)` topic events from
// the deployed borrow-pool contract and decodes each `BorrowReceipt`
// payload. Bypasses the local session store — the single source of
// truth is what the contract actually emitted.

const BORROW_TOPIC = "borrow"

// Testnet default event retention is ~24h at 5s/ledger. Look back a bit
// under the retention limit so we don't get "ledger not found" errors.
const LEDGER_LOOKBACK = 16_500

type ScValLike = {
  toXDR: (encoding?: string) => string
} & Record<string, unknown>

/**
 * Fetch every confirmed borrow for `account` (filter applied after the
 * RPC read; contract emits one event per confirmed borrow). Sorted
 * newest first. Returns `[]` on any RPC failure — caller decides how
 * to surface staleness.
 */
export async function fetchChainBorrowPositions(
  account: string,
  signal?: AbortSignal
): Promise<ChainBorrowReceipt[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })

  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)

  const topicScValB64 = sdk.xdr.ScVal
    .scvSymbol(BORROW_TOPIC)
    .toXDR("base64")

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[topicScValB64]],
        },
      ],
      startLedger,
      limit: 200,
    })
  } catch {
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  const receipts: ChainBorrowReceipt[] = []

  for (const event of events) {
    const decoded = decodeBorrowEvent(sdk, event)
    if (!decoded) continue
    if (decoded.account !== account) continue
    receipts.push(decoded)
  }

  receipts.sort((a, b) => b.confirmedAt - a.confirmedAt)
  return receipts
}

function extractEvents(response: unknown): { value?: unknown }[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as { value?: unknown }[]) : []
}

function decodeBorrowEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: { value?: unknown }
): ChainBorrowReceipt | null {
  const rawValue = event.value
  if (!rawValue) return null

  const scVal = toScVal(sdk, rawValue)
  if (!scVal) return null

  let native: unknown
  try {
    native = sdk.scValToNative(scVal)
  } catch {
    return null
  }

  if (!native || typeof native !== "object") return null

  const receipt = native as {
    account?: string
    borrow_symbol?: string
    collateral_symbol?: string
    confirmed_at?: bigint | number
    market?: string
    proof_id?: Buffer | Uint8Array | ArrayBuffer
  }

  if (
    typeof receipt.account !== "string" ||
    typeof receipt.borrow_symbol !== "string" ||
    typeof receipt.collateral_symbol !== "string" ||
    typeof receipt.market !== "string" ||
    receipt.confirmed_at === undefined ||
    !receipt.proof_id
  ) {
    return null
  }

  return {
    account: receipt.account,
    borrowSymbol: receipt.borrow_symbol,
    collateralSymbol: receipt.collateral_symbol,
    confirmedAt: Number(receipt.confirmed_at),
    market: receipt.market,
    proofId: bytesToHex(receipt.proof_id),
  }
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

  const asRecord = value as ScValLike
  if (asRecord && typeof asRecord.toXDR === "function") {
    return value as InstanceType<typeof sdk.xdr.ScVal>
  }

  return null
}

function bytesToHex(bytes: Buffer | Uint8Array | ArrayBuffer): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes as unknown as ArrayBufferLike)
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
