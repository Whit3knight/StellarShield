import type * as React from "react"

import { getMarketPair, type MarketCardData } from "../_constants/dashboard"

import { Badge } from "@/components/ui/badge"
import { Sparkline } from "@/components/molecules/sparkline"
import { Card, CardPanel } from "@/components/ui/card"
import { Frame, FrameHeader, FrameTitle } from "@/components/ui/frame"
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
  const marketMetrics = [
    { label: "Supply APY", value: market.supplyApy },
    { label: "Borrow APR", value: market.borrowApr },
    { label: "Available funds", value: market.availableFunds },
    { label: "Utilization", value: market.utilization },
  ]

  return (
    <Frame
      aria-label={`View ${marketPair} market`}
      aria-pressed={active}
      className={cn(
        "w-full cursor-pointer rounded-lg transition-[background-color,box-shadow] hover:bg-muted focus-visible:ring-[3px] focus-visible:outline-none",
        active
          ? "ring-1 ring-primary/40 ring-offset-4 ring-offset-background focus-visible:ring-ring/50"
          : "focus-visible:ring-ring/40"
      )}
      onClick={onViewMarket}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onViewMarket()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <FrameHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <FrameTitle className="flex items-center gap-2 text-base">
              {marketPair}
            </FrameTitle>
          </div>
          <Badge className="shrink-0" variant="outline">
            {market.risk}
          </Badge>
        </div>
      </FrameHeader>

      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="p-0">
          <Sparkline
            className="w-full rounded-md text-chart-2"
            label={`${market.symbol} borrow APR trend`}
            points={market.chart}
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
    </Frame>
  )
}
