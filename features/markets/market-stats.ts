import { SUPPORTED_ASSETS, type ShieldedAsset } from "@/features/notes"
import { getRateParams } from "@/features/protocol/rate-params"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

import { fetchMarketHistory, type CurrentTotals } from "./market-history"

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
// canonical source now. `chart` is populated separately by
// `fetchMarketHistory`, replaying real deposit/borrow/withdraw/repay
// events backward from these same totals.

export type MarketStat = {
  chart: { label: string; value: number }[]
  latestActivityAt: number | null
  loanNextIndex: number
  openPositions: number
  totalBorrows: number
  totalDeposits: number
  totalRepays: number
  /** R17: real value deposited/borrowed, in the asset's RAW token
   * units — distinct from `totalDeposits`/`totalBorrows` above (note
   * counts, still used for `openPositions` and tree-indexing
   * semantics). Utilization/APR/available-liquidity math should read
   * these, not the counts, now that note amounts vary. */
  totalDepositsValue: number
  totalBorrowsValue: number
}

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
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: SIMULATION_SOURCE,
  })

  const counters: Partial<Record<ShieldedAsset, AssetCounters>> = {}
  await Promise.all(
    SUPPORTED_ASSETS.map(async (asset) => {
      const readCounters = readAssetCounters(client, asset)
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 10_000)
      )
      const raced = await Promise.race([readCounters, timeout])
      if (signal?.aborted) return
      if (!raced) return
      counters[asset] = raced
    })
  )
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  // R17: the history replay's utilization math needs real VALUE, not
  // note counts — feed it the value counters, not totalDeposits/totalBorrows.
  const currentTotals = Object.fromEntries(
    SUPPORTED_ASSETS.map((asset) => [
      asset,
      {
        totalBorrows: counters[asset]?.totalBorrowsValue ?? 0,
        totalDeposits: counters[asset]?.totalDepositsValue ?? 0,
      },
    ])
  ) as CurrentTotals

  const liveRateParams = await getRateParams().catch(() => null)
  const rateParams = liveRateParams
    ? {
        baseApr: liveRateParams.baseAprBps / 10_000,
        slopeApr: liveRateParams.slopeAprBps / 10_000,
      }
    : undefined
  const history = await fetchMarketHistory({ currentTotals, rateParams, signal })

  const stats: Record<string, MarketStat> = {}
  for (const asset of SUPPORTED_ASSETS) {
    const raced = counters[asset]
    if (!raced) continue
    stats[asset] = {
      chart: history[asset],
      latestActivityAt: null,
      loanNextIndex: raced.loanNextIndex,
      openPositions: raced.totalBorrows,
      totalBorrows: raced.totalBorrows,
      totalDeposits: raced.totalDeposits,
      totalRepays: 0,
      totalBorrowsValue: raced.totalBorrowsValue,
      totalDepositsValue: raced.totalDepositsValue,
    }
  }

  return stats
}

type AssetCounters = {
  totalDeposits: number
  totalBorrows: number
  loanNextIndex: number
  totalDepositsValue: number
  totalBorrowsValue: number
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
    total_deposit_value: (
      args: { asset: string }
    ) => Promise<{ result: bigint | undefined }>
    total_borrow_value: (
      args: { asset: string }
    ) => Promise<{ result: bigint | undefined }>
  },
  asset: ShieldedAsset
): Promise<AssetCounters | null> {
  try {
    const [depositTx, borrowTx, loanIndexTx, depositValueTx, borrowValueTx] =
      await Promise.all([
        client.total_deposit({ asset }),
        client.total_borrow({ asset }),
        client.loan_next_index({ asset }),
        client.total_deposit_value({ asset }),
        client.total_borrow_value({ asset }),
      ])
    return {
      totalDeposits: Number(depositTx.result ?? 0n),
      totalBorrows: Number(borrowTx.result ?? 0n),
      loanNextIndex: Number(loanIndexTx.result ?? 0n),
      totalDepositsValue: Number(depositValueTx.result ?? 0n),
      totalBorrowsValue: Number(borrowValueTx.result ?? 0n),
    }
  } catch {
    return null
  }
}
