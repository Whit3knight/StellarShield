import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { MetricTile } from "@/components/atoms/metric-tile"
import { RateTrendChart } from "@/components/molecules/rate-trend-chart"
import { Card, CardPanel } from "@/components/ui/card"
import { type MarketCardData } from "@/features/markets"
import { getWalletAssetBalanceDisplay } from "@/features/wallet/utils"

import { formatPairPrice } from "../../format"

type MarketDetailStepProps = {
  account: ConnectedAccount | null
  market: MarketCardData
}

export function MarketDetailStep({
  account,
  market,
}: MarketDetailStepProps): React.ReactElement {
  const borrowBalance = getWalletAssetBalanceDisplay(account, market.symbol)
  const collateralBalance = getWalletAssetBalanceDisplay(
    account,
    market.collateral
  )

  return (
    <>
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

      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Supply APY" value={market.supplyApy} />
        <MetricTile label="Pair price" value={formatPairPrice(market)} />
        <MetricTile label={`${market.symbol} balance`} value={borrowBalance} />
        <MetricTile
          label={`${market.collateral} collateral`}
          value={collateralBalance}
        />
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
