import { RefreshCwIcon } from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { DetailRow } from "@/components/atoms/detail-row"
import { Button } from "@/components/ui/button"
import { Card, CardPanel } from "@/components/ui/card"
import type { MarketCardData } from "@/features/markets"

import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { createTransactionPreview } from "../../utils"

type TransactionStepProps = {
  account: ConnectedAccount | null
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
  account,
  flow,
  market,
  metrics,
  onRefreshTransaction,
}: TransactionStepProps): React.ReactElement {
  const isConfirmed = flow.transactionStatus === "Confirmed"
  const preview = createTransactionPreview({ account, flow, market, metrics })

  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Market" value={preview.market} />
          <DetailRow label="Account" privateValue value={preview.account} />
          <DetailRow label="Collateral" value={preview.collateral} />
          <DetailRow label="Collateral value" value={preview.collateralValue} />
          <DetailRow label="Loan amount" value={preview.loan} />
          <DetailRow label="Loan value" value={preview.loanValue} />
          <DetailRow label="Borrow APR" value={preview.borrowApr} />
          <DetailRow label="Health factor" value={preview.healthFactor} />
          <DetailRow label="Loan health" value={preview.loanHealth} />
          <DetailRow label="Verification" value={preview.verification} />
          <DetailRow label="Proof" privateValue value={preview.proof} />
          <TransactionStatusRow
            isConfirmed={isConfirmed}
            onRefreshTransaction={onRefreshTransaction}
            status={preview.status}
          />
          <DetailRow label="Estimated fee" value={preview.estimatedFee} />
          {preview.receipt ? (
            <DetailRow label="Receipt" privateValue value={preview.receipt} />
          ) : null}
        </CardPanel>
      </Card>
    </>
  )
}
