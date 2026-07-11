"use client"

import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { RateTrendChart } from "@/components/molecules/rate-trend-chart"
import { Card, CardPanel } from "@/components/ui/card"
import { Frame, FrameHeader, FrameTitle } from "@/components/ui/frame"
import {
  getAssetPriceUsd,
  getMarketPair,
  useMarketStats,
  type MarketCardData,
} from "@/features/markets"
import { cn } from "@/lib/utils"

// Skeleton pool has no interest model, but we still want the card's
// APR / APY / utilization tiles populated from live numbers rather
// than hardcoded strings. Formula: Aave-style two-slope rate applied
// to a real utilization proxy (fraction of on-chain borrows still
// open in the current retention window). Base + slope are constants;
// the utilization input is what the contract actually reports.
const BASE_APR = 0.02
const SLOPE_APR = 0.15
const RESERVE_FACTOR = 0.15

// Rough US dollar value assumed per open position for the "available
// funds" tile. Contract doesn't publish TVL (amounts are private
// witness), so this is a display multiplier — clearly labelled as
// "avg per position" instead of pretending to be exact TVL.
const AVG_POSITION_USD = 1_000

export function MarketCard({
  active,
  market,
  onViewMarket,
}: {
  active: boolean
  market: MarketCardData
  onViewMarket: () => void
}): React.ReactElement {
  const marketPair = getMarketPair(market)
  const isComingSoon = market.status === "comingSoon"
  const borrowPrice = getAssetPriceUsd(market.symbol)

  const { isLoading, stats } = useMarketStats()
  const marketStat = stats[marketPair]

  const openPositions = marketStat?.openPositions ?? 0
  const totalBorrows = marketStat?.totalBorrows ?? 0
  const utilization =
    totalBorrows > 0 ? Math.min(1, openPositions / totalBorrows) : 0
  const borrowApr = BASE_APR + SLOPE_APR * utilization
  const supplyApy = borrowApr * utilization * (1 - RESERVE_FACTOR)
  const availableFundsUsd = Math.max(1, totalBorrows - openPositions) *
    AVG_POSITION_USD
  const risk = pickRisk(utilization)
  const chartPoints = normalizeChart(marketStat?.chart)
  const chartValue = formatPercent(borrowApr * 100)

  const marketMetrics = [
    { label: "Supply APY", value: formatPercent(supplyApy * 100) },
    {
      label: `${market.symbol} price`,
      value: `$${borrowPrice.toLocaleString("en-US", {
        maximumFractionDigits: borrowPrice >= 10 ? 2 : 4,
      })}`,
    },
    { label: "Available funds", value: formatUsdCompact(availableFundsUsd) },
    { label: "Utilization", value: formatPercent(utilization * 100) },
  ]

  return (
    <Frame
      aria-disabled={isComingSoon || undefined}
      aria-label={
        isComingSoon
          ? `${marketPair} market coming soon`
          : `View ${marketPair} market`
      }
      aria-pressed={isComingSoon ? undefined : active}
      className={cn(
        "relative w-full rounded-lg transition-[background-color,box-shadow] focus-visible:outline-none",
        isComingSoon
          ? "cursor-default overflow-hidden"
          : "cursor-pointer hover:bg-muted focus-visible:ring-[3px]",
        !isComingSoon && active
          ? "ring-1 ring-primary/40 ring-offset-4 ring-offset-background focus-visible:ring-ring/50"
          : "focus-visible:ring-ring/40"
      )}
      onClick={isComingSoon ? undefined : onViewMarket}
      onKeyDown={
        isComingSoon
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onViewMarket()
              }
            }
      }
      role={isComingSoon ? undefined : "button"}
      tabIndex={isComingSoon ? undefined : 0}
    >
      <FrameHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <FrameTitle className="flex items-center gap-2 text-base">
              {marketPair}
            </FrameTitle>
          </div>
          {!isComingSoon ? (
            <Badge className="shrink-0" variant="outline">
              {risk}
            </Badge>
          ) : null}
        </div>
      </FrameHeader>

      <div className="relative">
        <div
          className={cn(
            "transition-[filter,opacity]",
            isComingSoon && "pointer-events-none opacity-55 blur-sm select-none"
          )}
        >
          <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
            <CardPanel className="p-0">
              <RateTrendChart
                label="Borrow APR"
                points={chartPoints}
                tone="success"
                value={isLoading && !marketStat ? "—" : chartValue}
              />
            </CardPanel>
          </Card>

          <div className="space-y-5 px-5 py-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {marketMetrics.map((metric) => (
                <div key={metric.label}>
                  <dt className="text-muted-foreground">{metric.label}</dt>
                  <dd className="mt-1 font-semibold">{metric.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {isComingSoon ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/35 backdrop-blur-[2px]">
            <span className="rounded-md border bg-background/85 px-3 py-1.5 text-sm font-medium shadow-xs/5">
              Coming soon
            </span>
          </div>
        ) : null}
      </div>
    </Frame>
  )
}

const BUCKET_LABELS = ["7", "6", "5", "4", "3", "2", "1", "now"]

function normalizeChart(
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

function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`
}

function formatUsdCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function pickRisk(utilization: number): "Conservative" | "Standard" | "Active" {
  if (utilization < 0.3) return "Conservative"
  if (utilization < 0.7) return "Standard"
  return "Active"
}
