import { RefreshCwIcon } from "lucide-react"
import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { DetailRow } from "@/components/atoms/detail-row"
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

function TransactionStatusRow({
  isConfirmed,
  onRefreshTransaction,
  status,
}: {
  isConfirmed: boolean
  onRefreshTransaction: () => void
  status: string
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <span className="text-muted-foreground">Transaction status</span>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{status}</span>
        <Button
          aria-label="Refresh transaction status"
          disabled={isConfirmed}
          onClick={onRefreshTransaction}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
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
          <DetailRow
            label="Account"
            privateValue
            value={MOCK_ACCOUNT_ADDRESS}
          />
          <DetailRow
            label="Collateral"
            value={formatUsd(metrics.collateralValue)}
          />
          <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
          <DetailRow label="Borrow APR" value={market.borrowApr} />
          <DetailRow label="Loan health" value={metrics.loanHealth} />
          <DetailRow label="Verification" value={flow.verificationStatus} />
          <TransactionStatusRow
            isConfirmed={isConfirmed}
            onRefreshTransaction={onRefreshTransaction}
            status={flow.transactionStatus}
          />
          <DetailRow label="Estimated fee" value="0.00003 XLM" />
          {isConfirmed ? (
            <DetailRow
              label="Receipt"
              privateValue
              value={MOCK_TRANSACTION_HASH}
            />
          ) : null}
        </CardPanel>
      </Card>
    </>
  )
}
