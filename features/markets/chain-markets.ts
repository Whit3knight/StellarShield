import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Reads the borrow-pool contract's `list_markets()` view. Returns the
// authoritative set of market pairs registered on chain; the frontend
// pair list stays as UI-only metadata (APR / chart / risk copy) and
// gets filtered against this set at render time.

export type ChainMarket = {
  borrowSymbol: string
  collateralSymbol: string
  key: string
}

export async function fetchRegisteredMarkets(
  signal?: AbortSignal
): Promise<ChainMarket[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return []

  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: contractId,
  })

  let assembled
  try {
    assembled = await client.list_markets()
  } catch {
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const raw = assembled.result as unknown
  if (!Array.isArray(raw)) return []

  const markets: ChainMarket[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as {
      borrow_symbol?: string
      collateral_symbol?: string
      key?: string
    }
    if (!m.borrow_symbol || !m.collateral_symbol || !m.key) continue
    markets.push({
      borrowSymbol: m.borrow_symbol,
      collateralSymbol: m.collateral_symbol,
      key: m.key,
    })
  }
  return markets
}

export function chainMarketPairKey(market: ChainMarket): string {
  return `${market.borrowSymbol}/${market.collateralSymbol}`
}
