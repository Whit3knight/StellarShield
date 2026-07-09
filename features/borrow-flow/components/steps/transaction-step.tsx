import {
  ActivityIcon,
  FileCheckIcon,
  LandmarkIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { Button } from "@/components/ui/button"
import type { MarketCardData } from "@/features/markets"

import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { createTransactionPreview } from "../../utils"
import { TimelineItem, TimelineSection } from "../flow-timeline"

type TransactionStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onRefreshTransaction: () => void
}

function RefreshTransactionButton({
  showRefresh,
  onRefreshTransaction,
}: {
  showRefresh: boolean
  onRefreshTransaction: () => void
}): React.ReactElement | null {
  if (!showRefresh) {
    return null
  }

  return (
    <Button
      aria-label="Refresh transaction status"
      onClick={onRefreshTransaction}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <RefreshCwIcon aria-hidden="true" />
    </Button>
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
  const signStatus = getTransactionTimelineStatus(flow.transactionStatus)

  return (
    <TimelineSection>
      <TimelineItem
        amount={preview.collateral}
        from={preview.account}
        icon={WalletIcon}
        info="Collateral is locked before borrowed liquidity is released."
        label="Lock collateral"
        meta={[
          {
            label: "Value",
            value: preview.collateralValue,
          },
          {
            label: "Market",
            value: preview.market,
          },
        ]}
        privateFrom
        status="done"
        to={marketVault}
      />
      <TimelineItem
        amount={preview.loan}
        from={marketPool}
        icon={LandmarkIcon}
        info="Borrowed liquidity is sent back to the connected wallet after the collateral leg is accepted."
        label="Draw borrow"
        meta={[
          {
            label: "Value",
            value: preview.loanValue,
          },
          {
            label: "Borrow APR",
            value: preview.borrowApr,
          },
        ]}
        privateTo
        status="done"
        to={preview.account}
      />
      <TimelineItem
        amount={preview.proof}
        from="Proof"
        icon={FileCheckIcon}
        info="The transaction includes the verified proof and borrow intent instead of raw private wallet data."
        label="Attach proof"
        meta={[
          {
            label: "Intent",
            privateValue: Boolean(flow.borrowIntent),
            value: preview.intentId,
          },
          {
            label: "Simulation",
            value: preview.simulation,
          },
          {
            label: "Operation",
            value: preview.operation,
          },
          {
            label: "Memo",
            info: "Memo is deterministic and used to bind the signed transaction to this borrow intent.",
            value: preview.memo,
            wide: true,
          },
        ]}
        privateAmount={Boolean(flow.proof)}
        privateTo
        status={flow.proof && flow.borrowIntent ? "done" : "pending"}
        to="Borrow intent"
      />
      <TimelineItem
        action={
          <RefreshTransactionButton
            onRefreshTransaction={onRefreshTransaction}
            showRefresh={showRefresh}
          />
        }
        amount={preview.status}
        from={preview.account}
        icon={ActivityIcon}
        info="Wallet signature starts settlement. Refresh is only needed while the request is signing or submitted."
        label="Sign transaction"
        meta={[
          {
            label: "Estimated fee",
            value: preview.estimatedFee,
          },
          {
            label: "Health factor",
            value: preview.healthFactor,
          },
          {
            label: "Network",
            value: preview.network,
          },
        ]}
        privateFrom
        status={signStatus}
        to="Stellar wallet"
      />
      <TimelineItem
        amount={preview.receipt ?? "After confirmation"}
        from="Stellar ledger"
        icon={ReceiptTextIcon}
        info="Confirmed transactions expose a receipt hash for lookup while wallet details can stay masked."
        isLast
        label="Receipt"
        meta={[
          {
            label: "Status",
            value: preview.status,
          },
          {
            label: "Loan health",
            value: preview.loanHealth,
          },
        ]}
        privateAmount={Boolean(preview.receipt)}
        status={preview.receipt ? "done" : "pending"}
        to="Wallet"
      />
    </TimelineSection>
  )
}

function getTransactionTimelineStatus(
  status: BorrowFlowState["transactionStatus"]
): "active" | "done" | "failed" | "pending" {
  if (status === "Confirmed") {
    return "done"
  }

  if (status === "Failed") {
    return "failed"
  }

  if (status === "Ready" || status === "Signing" || status === "Submitted") {
    return "active"
  }

  return "pending"
}
