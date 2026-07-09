import {
  ActivityIcon,
  CoinsIcon,
  FileCheckIcon,
  HashIcon,
  HeartPulseIcon,
  LandmarkIcon,
  NetworkIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  RouteIcon,
  SendIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { Button } from "@/components/ui/button"
import type { MarketCardData } from "@/features/markets"

import { SummaryRow, SummarySection, TransferRoute } from "../summary-list"
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
  showRefresh,
  onRefreshTransaction,
  status,
}: {
  showRefresh: boolean
  onRefreshTransaction: () => void
  status: string
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
        <ActivityIcon aria-hidden="true" className="size-4" />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <span className="text-muted-foreground">Transaction status</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{status}</span>
          {showRefresh ? (
            <Button
              aria-label="Refresh transaction status"
              onClick={onRefreshTransaction}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
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
  const showRefresh =
    flow.transactionStatus === "Signing" ||
    flow.transactionStatus === "Submitted"
  const preview = createTransactionPreview({ account, flow, market, metrics })
  const marketVault = `${market.collateral} vault`
  const marketPool = `${market.symbol} pool`

  return (
    <>
      <SummarySection
        description="What leaves the wallet and what comes back after signing."
        icon={SendIcon}
        title="Asset movement"
      >
        <TransferRoute
          amount={preview.collateral}
          description="Collateral is locked before the borrow draw is released."
          from={preview.account}
          icon={WalletIcon}
          label="Send collateral"
          privateFrom
          to={marketVault}
        />
        <TransferRoute
          amount={preview.loan}
          description="Borrowed liquidity is sent back to the connected wallet."
          from={marketPool}
          icon={LandmarkIcon}
          label="Receive borrow"
          privateTo
          to={preview.account}
        />
      </SummarySection>

      <SummarySection
        description="Deterministic payload prepared from the verified borrow intent."
        icon={RouteIcon}
        title="Protocol payload"
      >
        <SummaryRow icon={LandmarkIcon} label="Market" value={preview.market} />
        <SummaryRow
          icon={ActivityIcon}
          label="Simulation"
          value={preview.simulation}
        />
        <SummaryRow
          icon={HashIcon}
          label="Intent"
          privateValue
          value={preview.intentId}
        />
        <SummaryRow
          icon={FileCheckIcon}
          label="Proof"
          privateValue
          value={preview.proof}
        />
        <SummaryRow
          icon={NetworkIcon}
          label="Network"
          value={preview.network}
        />
        <SummaryRow
          icon={RouteIcon}
          label="Operation"
          value={preview.operation}
        />
        <SummaryRow
          icon={HashIcon}
          label="Memo"
          multiline
          value={preview.memo}
        />
      </SummarySection>

      <SummarySection
        description="Risk, fee, and settlement status before wallet signature completes."
        icon={HeartPulseIcon}
        title="Settlement"
      >
        <TransactionStatusRow
          onRefreshTransaction={onRefreshTransaction}
          showRefresh={showRefresh}
          status={preview.status}
        />
        <SummaryRow
          icon={CoinsIcon}
          label="Loan value"
          value={preview.loanValue}
        />
        <SummaryRow
          icon={CoinsIcon}
          label="Collateral value"
          value={preview.collateralValue}
        />
        <SummaryRow
          icon={ActivityIcon}
          label="Borrow APR"
          value={preview.borrowApr}
        />
        <SummaryRow
          icon={HeartPulseIcon}
          label="Health factor"
          value={preview.healthFactor}
        />
        <SummaryRow
          icon={CoinsIcon}
          label="Estimated fee"
          value={preview.estimatedFee}
        />
        {preview.receipt ? (
          <SummaryRow
            icon={ReceiptTextIcon}
            label="Receipt"
            privateValue
            value={preview.receipt}
          />
        ) : null}
      </SummarySection>
    </>
  )
}
