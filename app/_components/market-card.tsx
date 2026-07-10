import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { RateTrendChart } from "@/components/molecules/rate-trend-chart"
import { Card, CardPanel } from "@/components/ui/card"
import { Frame, FrameHeader, FrameTitle } from "@/components/ui/frame"
import {
  getAssetPriceUsd,
  getMarketPair,
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
  const marketMetrics = [
    { label: "Supply APY", value: market.supplyApy },
    {
      label: `${market.symbol} price`,
      value: `$${borrowPrice.toLocaleString("en-US", {
        maximumFractionDigits: borrowPrice >= 10 ? 2 : 4,
      })}`,
    },
    { label: "Available funds", value: market.availableFunds },
    { label: "Utilization", value: market.utilization },
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
              {market.risk}
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
                points={market.chart}
                tone={market.chartTone}
                value={market.borrowApr}
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
