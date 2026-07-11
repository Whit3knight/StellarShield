import type { MarketStat } from "./market-stats"

// Shared rate curve so market-card, market-detail-step, borrow-terms,
// and command-search all show the same numbers for a given pair. The
// contract has no interest model, so the curve constants are fixed;
// the utilization input is real (event-derived).
export const BASE_APR = 0.02
export const SLOPE_APR = 0.15
export const RESERVE_FACTOR = 0.15

// Rough dollar value assumed per open position for the "available
// funds" display tile. Contract doesn't publish TVL (amounts are
// private witness), so this is a display multiplier only.
export const AVG_POSITION_USD = 1_000

export type DerivedMarketMetrics = {
  availableFundsUsd: number
  borrowApr: number
  chart: { label: string; value: number }[]
  latestActivityAt: number | null
  openPositions: number
  supplyApy: number
  totalBorrows: number
  utilization: number
}

export function deriveMarketMetrics(
  stat: MarketStat | undefined
): DerivedMarketMetrics {
  const openPositions = stat?.openPositions ?? 0
  const totalBorrows = stat?.totalBorrows ?? 0
  const utilization =
    totalBorrows > 0 ? Math.min(1, openPositions / totalBorrows) : 0
  const borrowApr = BASE_APR + SLOPE_APR * utilization
  const supplyApy = borrowApr * utilization * (1 - RESERVE_FACTOR)
  const availableFundsUsd =
    Math.max(1, totalBorrows - openPositions) * AVG_POSITION_USD
  const chart = stat?.chart ?? []
  const latestActivityAt = stat?.latestActivityAt ?? null

  return {
    availableFundsUsd,
    borrowApr,
    chart,
    latestActivityAt,
    openPositions,
    supplyApy,
    totalBorrows,
    utilization,
  }
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`
}

export function formatUsdCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function pickRisk(
  utilization: number
): "Conservative" | "Standard" | "Active" {
  if (utilization < 0.3) return "Conservative"
  if (utilization < 0.7) return "Standard"
  return "Active"
}

const BUCKET_LABELS = ["7", "6", "5", "4", "3", "2", "1", "now"]

export function normalizeChart(
  points?: { label: string; value: number }[]
): { label: string; value: number }[] {
  const source = points ?? []
  if (source.length === 0) {
    return BUCKET_LABELS.map((label) => ({ label, value: 0.2 }))
  }
  return source.map((point, index) => ({
    label: BUCKET_LABELS[index] ?? point.label,
    value: point.value,
  }))
}
