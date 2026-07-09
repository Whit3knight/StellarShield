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
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
import { Button } from "@/components/ui/button"
import type { MarketCardData } from "@/features/markets"

import type {
  BorrowActivity,
  BorrowFlowMetrics,
  BorrowFlowState,
  UserPosition,
} from "../../types"
import { formatAssetAmount, formatUsd } from "../../format"
import { createTransactionPreview } from "../../preview"
import { TimelineItem, TimelineSection } from "../flow-timeline"

type TransactionStepProps = {
  account: ConnectedAccount | null
  activity: BorrowActivity[]
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onRefreshTransaction: () => void
  position: UserPosition | null
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
  activity,
  flow,
  market,
  metrics,
  onRefreshTransaction,
  position,
}: TransactionStepProps): React.ReactElement {
  const showRefresh =
    flow.transactionStatus === "Signing" ||
    flow.transactionStatus === "Submitted"
  const preview = createTransactionPreview({ account, flow, market, metrics })
  const marketVault = `${market.collateral} vault`
  const marketPool = `${market.symbol} pool`
  const signStatus = getTransactionTimelineStatus(flow.transactionStatus)

  return (
    <>
      <RiskSummary market={market} metrics={metrics} />
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
      {position ? <OpenPositionSummary position={position} /> : null}
      <ActivityFeed activity={activity} />
    </>
  )
}

function RiskSummary({
  market,
  metrics,
}: {
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): React.ReactElement {
  const loanToValue =
    metrics.collateralValue > 0 ? metrics.loanValue / metrics.collateralValue : 0
  const liquidationPrice =
    metrics.liquidationPrice === null
      ? "N/A"
      : `${formatUsd(metrics.liquidationPrice)} / ${market.collateral}`

  return (
    <section className="grid grid-cols-2 gap-3">
      <MetricTile label="LTV" value={`${Math.round(loanToValue * 100)}%`} />
      <MetricTile
        label="Borrowing power used"
        value={`${Math.round(metrics.utilization * 100)}%`}
      />
      <MetricTile
        label="Health factor"
        value={
          metrics.healthFactor === null ? "N/A" : metrics.healthFactor.toFixed(2)
        }
      />
      <MetricTile label="Liquidation price" value={liquidationPrice} />
    </section>
  )
}

function OpenPositionSummary({
  position,
}: {
  position: UserPosition
}): React.ReactElement {
  const supplied = position.supplied[0]
  const borrowed = position.borrowed[0]
  const openedAt = formatShortDate(position.openedAt)
  const nextPaymentDue = formatShortDate(position.nextPaymentDue)

  return (
    <section className="rounded-lg border bg-background/72 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm">Open position</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Confirmed position for {position.market}
          </p>
        </div>
        <span className="rounded-md border px-2 py-1 text-success-foreground text-xs">
          {position.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <PositionRow
          label="Supplied"
          value={
            supplied
              ? `${formatAssetAmount(supplied.amount, supplied.symbol)} (${formatUsd(supplied.valueUsd)})`
              : "N/A"
          }
        />
        <PositionRow
          label="Borrowed"
          value={
            borrowed
              ? `${formatAssetAmount(borrowed.amount, borrowed.symbol)} (${formatUsd(borrowed.valueUsd)})`
              : "N/A"
          }
        />
        <PositionRow label="Borrow APR" value={position.borrowApr} />
        <PositionRow
          label="Health factor"
          value={
            position.healthFactor === null
              ? "N/A"
              : position.healthFactor.toFixed(2)
          }
        />
        <PositionRow label="Opened" value={openedAt} />
        <PositionRow label="Next review" value={nextPaymentDue} />
        <PositionRow label="Receipt" privateValue value={position.receiptHash} />
      </div>
    </section>
  )
}

function PositionRow({
  label,
  privateValue = false,
  value,
}: {
  label: string
  privateValue?: boolean
  value: string
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      {privateValue ? (
        <PrivateValue className="max-w-[60%] text-right font-medium break-words">
          {value}
        </PrivateValue>
      ) : (
        <span className="max-w-[60%] text-right font-medium break-words">
          {value}
        </span>
      )}
    </div>
  )
}

function ActivityFeed({
  activity,
}: {
  activity: BorrowActivity[]
}): React.ReactElement | null {
  if (activity.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border bg-background/72 p-4">
      <h3 className="font-medium text-sm">Activity</h3>
      <div className="mt-3 divide-y">
        {activity.map((item) => (
          <div className="py-3 first:pt-0 last:pb-0" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.title}</div>
                <div className="mt-0.5 text-muted-foreground text-xs">
                  {item.description}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="text-muted-foreground">
                  {formatShortTime(item.timestamp)}
                </div>
                <div className="mt-1 capitalize">{item.status}</div>
              </div>
            </div>
            {item.value ? (
              <div className="mt-2 truncate rounded-md border bg-muted/24 px-2 py-1 text-xs">
                {item.privateValue ? (
                  <PrivateValue>{item.value}</PrivateValue>
                ) : (
                  item.value
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value))
}

function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
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
