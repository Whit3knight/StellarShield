import { RefreshCwIcon } from "lucide-react"
import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { DetailRow } from "@/components/atoms/detail-row"
import { MetricTile } from "@/components/atoms/metric-tile"
import { Button } from "@/components/ui/button"
import { Card, CardPanel } from "@/components/ui/card"

import { MOCK_ACCOUNT_ADDRESS, MOCK_TRANSACTION_HASH } from "../../constants"
import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { formatUsd } from "../../utils"

type TransactionStepProps = {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onRefreshTransaction: () => void
}

export function TransactionStep({
  flow,
  market,
  metrics,
  onRefreshTransaction,
}: TransactionStepProps): React.ReactElement {
  const isConfirmed = flow.transactionStatus === "Confirmed"

  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow label="Account" value={MOCK_ACCOUNT_ADDRESS} />
          <DetailRow
            label="Collateral"
            value={formatUsd(metrics.collateralValue)}
          />
          <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
          <DetailRow label="Borrow APR" value={market.borrowApr} />
          <DetailRow label="Loan health" value={metrics.loanHealth} />
          <DetailRow label="Verification" value={flow.verificationStatus} />
          <DetailRow label="Estimated fee" value="0.00003 XLM" />
          {isConfirmed ? (
            <DetailRow label="Receipt" value={MOCK_TRANSACTION_HASH} />
          ) : null}
        </CardPanel>
      </Card>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">Transaction status</div>
            <p className="mt-1 text-muted-foreground">
              {isConfirmed
                ? "Transaction has been confirmed on Stellar."
                : "Transaction was submitted. Refresh to check the latest state."}
            </p>
          </div>
          <Button
            aria-label="Refresh transaction status"
            disabled={isConfirmed}
            onClick={onRefreshTransaction}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MetricTile label="State" value={flow.transactionStatus} />
          <MetricTile label="Receipt" value={MOCK_TRANSACTION_HASH} />
        </div>
        <p className="mt-1 text-muted-foreground">
          The borrow receipt is ready for Activity after confirmation.
        </p>
      </div>
    </>
  )
}
