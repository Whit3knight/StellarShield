import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { DetailRow } from "@/components/atoms/detail-row"
import { MetricTile } from "@/components/atoms/metric-tile"
import { Card, CardPanel } from "@/components/ui/card"

import { MOCK_ACCOUNT_ADDRESS, MOCK_ACCOUNT_BALANCE } from "../../constants"
import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { formatUsd } from "../../utils"

type VerificationStepProps = {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}

export function VerificationStep({
  flow,
  market,
  metrics,
}: VerificationStepProps): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Account" value={MOCK_ACCOUNT_ADDRESS} />
          <DetailRow label="Balance" value={MOCK_ACCOUNT_BALANCE} />
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow
            label="Borrowing power"
            value={formatUsd(metrics.borrowingPower)}
          />
          <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
        </CardPanel>
      </Card>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="font-medium">Private verification</div>
        <p className="mt-1 text-muted-foreground">
          Eligibility is checked before submission without exposing sensitive
          wallet details.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MetricTile label="Status" value={flow.verificationStatus} />
          <MetricTile label="Loan health" value={metrics.loanHealth} />
        </div>
      </div>
    </>
  )
}
