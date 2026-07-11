import type { ChainBorrowReceipt } from "@/features/protocol"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Chain-derived borrow receipts. Contract exposes
// `positions_by_account(account) -> Vec<BorrowReceipt>` — reads persistent
// storage directly, so we don't hit the RPC event-retention window.
// Sorted newest first.

export async function fetchChainBorrowPositions(
  account: string,
  signal?: AbortSignal
): Promise<ChainBorrowReceipt[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: account,
  })

  let assembled
  try {
    assembled = await client.positions_by_account({ account })
  } catch {
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const raw = assembled.result as unknown
  if (!Array.isArray(raw)) return []

  const receipts: ChainBorrowReceipt[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as {
      account?: string
      borrow_symbol?: string
      collateral_symbol?: string
      confirmed_at?: bigint | number
      market?: string
      proof_id?: Buffer | Uint8Array
    }
    if (
      typeof r.account !== "string" ||
      typeof r.borrow_symbol !== "string" ||
      typeof r.collateral_symbol !== "string" ||
      typeof r.market !== "string" ||
      r.confirmed_at === undefined ||
      !r.proof_id
    ) {
      continue
    }
    receipts.push({
      account: r.account,
      borrowSymbol: r.borrow_symbol,
      collateralSymbol: r.collateral_symbol,
      confirmedAt: Number(r.confirmed_at),
      market: r.market,
      proofId: bytesToHex(r.proof_id),
    })
  }

  receipts.sort((a, b) => b.confirmedAt - a.confirmedAt)
  return receipts
}

function bytesToHex(bytes: Buffer | Uint8Array): string {
  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes as unknown as ArrayBufferLike)
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
