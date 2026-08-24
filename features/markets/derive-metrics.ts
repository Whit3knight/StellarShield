import { DENOMINATION, type ShieldedAsset } from "@/features/notes"

import { assets } from "./data"
import type { MarketStat } from "./market-stats"
import { getAssetPriceUsd } from "./utils"

// Shared rate curve so market-card, market-detail-step, borrow-terms,
// and command-search all show the same numbers for a given asset.
// `BASE_APR`/`SLOPE_APR` are fallbacks for the contract's real
// `rate_params()` (see `features/protocol/rate-params.ts`); utilisation
// mirrors the contract's own formula (`rate.rs::utilization`).
export const BASE_APR = 0.02
export const SLOPE_APR = 0.15

export type DerivedMarketMetrics = {
  availableFundsUsd: number
  borrowApr: number
  chart: { label: string; value: number }[]
  latestActivityAt: number | null
  openPositions: number
  totalBorrows: number
  utilization: number
}

export function deriveMarketMetrics(
  stat: MarketStat | undefined,
  borrowSymbol?: string,
  rateParams?: { baseApr: number; slopeApr: number }
): DerivedMarketMetrics {
  const totalDeposits = stat?.totalDeposits ?? 0
  const totalBorrows = stat?.totalBorrows ?? 0
  const openPositions = stat?.openPositions ?? totalBorrows
  const utilization =
    totalDeposits === 0 || totalBorrows === 0
      ? 0
      : totalBorrows / (totalDeposits + totalBorrows)
  const baseApr = rateParams?.baseApr ?? BASE_APR
  const slopeApr = rateParams?.slopeApr ?? SLOPE_APR
  const borrowApr = baseApr + slopeApr * utilization

  // Available liquidity in the borrow asset's pool = `deposits -
  // borrows` (in whole notes), priced through Reflector so the tile
  // reads in USD. `DENOMINATION` is in raw token units (stroops), so
  // scale it down before applying a per-whole-unit USD price. Falls
  // back to a 1-note floor so the card never shows `$0` when the pool
  // is exactly balanced.
  const asset = pickShieldedAsset(borrowSymbol)
  const availableNotes = Math.max(1, totalDeposits - totalBorrows)
  const availableFundsUsd = asset
    ? availableNotes *
      (Number(DENOMINATION[asset]) / 10 ** assets[asset].decimals) *
      Math.max(0, getAssetPriceUsd(asset))
    : availableNotes
  const chart = stat?.chart ?? []
  const latestActivityAt = stat?.latestActivityAt ?? null

  return {
    availableFundsUsd,
    borrowApr,
    chart,
    latestActivityAt,
    openPositions,
    totalBorrows,
    utilization,
  }
}

function pickShieldedAsset(symbol?: string): ShieldedAsset | null {
  if (symbol === "XLM" || symbol === "USDC" || symbol === "EURC") {
    return symbol
  }
  return null
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
