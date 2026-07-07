import type * as React from "react"

import { type MarketCardData } from "@/app/_constants/dashboard"
import { MetricTile } from "@/components/atoms/metric-tile"
import { Sparkline } from "@/components/molecules/sparkline"
import { Card, CardPanel } from "@/components/ui/card"

type MarketDetailStepProps = {
  market: MarketCardData
}

export function MarketDetailStep({
  market,
}: MarketDetailStepProps): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="p-0">
          <Sparkline
            className="w-full rounded-md text-chart-2"
            label={`${market.symbol} borrow APR trend`}
            points={market.chart}
          />
        </CardPanel>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Supply APY" value={market.supplyApy} />
        <MetricTile label="Borrow APR" value={market.borrowApr} />
        <MetricTile label="Available" value={market.availableFunds} />
        <MetricTile label="Utilization" value={market.utilization} />
      </div>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="font-medium">ZKP eligibility</div>
        <p className="mt-1 text-muted-foreground">
          Borrow eligibility is verified before transaction submission without
          exposing private wallet details.
        </p>
      </div>
    </>
  )
}
