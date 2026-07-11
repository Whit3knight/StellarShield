"use client"

import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Frame, FrameHeader, FrameTitle } from "@/components/ui/frame"
import {
  getAssetPriceUsd,
  getMarketPair,
  useMarketStats,
  type MarketCardData,
} from "@/features/markets"
import { cn } from "@/lib/utils"

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
  const collateralPrice = getAssetPriceUsd(market.collateral)

  const { isLoading, stats } = useMarketStats()
  const marketStat = stats[marketPair]

  const openPositions = marketStat?.openPositions ?? 0
  const totalBorrows = marketStat?.totalBorrows ?? 0
  const latestActivity = marketStat?.latestActivityAt
    ? formatRelative(new Date(marketStat.latestActivityAt * 1000))
    : isLoading
      ? "…"
      : "No activity yet"

  const metrics = [
    { label: `${market.symbol} price`, value: formatUsd(borrowPrice) },
    { label: `${market.collateral} price`, value: formatUsd(collateralPrice) },
    {
      label: "Borrows (24h)",
      value: isLoading && !marketStat ? "…" : `${totalBorrows}`,
    },
    { label: "Latest activity", value: latestActivity },
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
              Testnet
            </Badge>
          ) : null}
        </div>
      </FrameHeader>

      <div className="relative">
        <div
          className={cn(
            "space-y-4 px-5 py-4 transition-[filter,opacity]",
            isComingSoon && "pointer-events-none opacity-55 blur-sm select-none"
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Open positions</p>
              <p className="mt-1 text-2xl font-semibold">
                {isLoading && !marketStat ? "…" : openPositions}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              on-chain, all accounts
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt className="text-muted-foreground">{metric.label}</dt>
                <dd className="mt-1 font-semibold">{metric.value}</dd>
              </div>
            ))}
          </dl>
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

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 10 ? 2 : 4,
  })}`
}

function formatRelative(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 45) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
