import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { DetailRow } from "@/components/atoms/detail-row"
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
          <DetailRow
            label="Account"
            privateValue
            value={MOCK_ACCOUNT_ADDRESS}
          />
          <DetailRow
            label="Balance"
            privateValue
            value={MOCK_ACCOUNT_BALANCE}
          />
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow
            label="Borrowing power"
            value={formatUsd(metrics.borrowingPower)}
          />
          <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
          <DetailRow
            label="Private verification"
            value={flow.verificationStatus}
          />
          <DetailRow label="Loan health" value={metrics.loanHealth} />
          <DetailRow label="Wallet details" value="Not exposed" />
        </CardPanel>
      </Card>
    </>
  )
}
