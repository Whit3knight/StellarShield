import { SUPPORTED_ASSETS, type ShieldedAsset } from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Contract view-derived market stats. Reads
// `total_deposit(asset)` + `total_borrow(asset)` +
// `loan_next_index(asset)` from the shielded pool for every supported
// asset and returns one snapshot per BORROW asset. Consumers key by
// `market.symbol` (the borrow leg of the pair) — utilisation and
// available liquidity are properties of the borrow asset's pool, not
// of an individual borrow/collateral pair.
//
// The legacy event scan this file used to run keyed off a
// receipt-registry event shape (`borrow_symbol` / `collateral_symbol`
// on the event body) that the shielded borrow flow no longer emits,
// so cards were bottoming out on stale zeros. Contract views are the
// canonical source now.

export type MarketStat = {
  chart: { label: string; value: number }[]
  latestActivityAt: number | null
  loanNextIndex: number
  openPositions: number
  totalBorrows: number
  totalDeposits: number
  totalRepays: number
}

// Chart bucketing kept as-is so the mini rate chart on the card still
// draws a shape; per-bucket value is not populated by the view path.
const CHART_BUCKETS = 8

/**
 * Snapshot every supported asset's on-chain view counters and shape
 * the result so market cards can key by borrow-asset symbol.
 */
export async function fetchMarketStats(
  signal?: AbortSignal
): Promise<Record<string, MarketStat>> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return {}

  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  // A simulate-only public key — every view call is a `simulate`
  // transaction and Soroban requires a source account even for
  // read-only reads.
  const SIMULATION_SOURCE =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP66"
  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: SIMULATION_SOURCE,
  })

  const stats: Record<string, MarketStat> = {}
  await Promise.all(
    SUPPORTED_ASSETS.map(async (asset) => {
      const readCounters = readAssetCounters(client, asset)
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 10_000)
      )
      const raced = await Promise.race([readCounters, timeout])
      if (signal?.aborted) return
      if (!raced) return
      stats[asset] = {
        chart: makeEmptyChart(),
        latestActivityAt: null,
        loanNextIndex: raced.loanNextIndex,
        openPositions: raced.totalBorrows,
        totalBorrows: raced.totalBorrows,
        totalDeposits: raced.totalDeposits,
        totalRepays: 0,
      }
    })
  )

  return stats
}

type AssetCounters = {
  totalDeposits: number
  totalBorrows: number
  loanNextIndex: number
}

async function readAssetCounters(
  client: {
    total_deposit: (
      args: { asset: string }
    ) => Promise<{ result: bigint | undefined }>
    total_borrow: (
      args: { asset: string }
    ) => Promise<{ result: bigint | undefined }>
    loan_next_index: (
      args: { asset: string }
    ) => Promise<{ result: bigint | undefined }>
  },
  asset: ShieldedAsset
): Promise<AssetCounters | null> {
  try {
    const [depositTx, borrowTx, loanIndexTx] = await Promise.all([
      client.total_deposit({ asset }),
      client.total_borrow({ asset }),
      client.loan_next_index({ asset }),
    ])
    return {
      totalDeposits: Number(depositTx.result ?? 0n),
      totalBorrows: Number(borrowTx.result ?? 0n),
      loanNextIndex: Number(loanIndexTx.result ?? 0n),
    }
  } catch {
    return null
  }
}

function makeEmptyChart(): { label: string; value: number }[] {
  return Array.from({ length: CHART_BUCKETS }, (_, index) => ({
    label: `-${CHART_BUCKETS - index}`,
    value: 0,
  }))
}
