import { ReceiptTextIcon, ShieldCheckIcon } from "lucide-react"
import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
import type { MarketCardData } from "@/features/markets"

import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  UserPosition,
} from "../../types"
import { formatAssetAmount, formatUsd } from "../../format"
import { createTransactionPreview } from "../../preview"
import { TimelineItem, TimelineSection } from "../flow-timeline"

type TransactionStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  position: UserPosition | null
}

export function TransactionStep({
  account,
  flow,
  market,
  metrics,
  position,
}: TransactionStepProps): React.ReactElement {
  const preview = React.useMemo(
    () => createTransactionPreview({ account, flow, market, metrics }),
    [account, flow, market, metrics]
  )
  const settlement = getSettlementCopy(flow.transaction.status)

  return (
    <>
      {position ? null : <RiskSummary market={market} metrics={metrics} />}
      <TimelineSection>
        <TimelineItem
          amount={preview.receipt ?? settlement.pendingCaption}
          from="Wallet signature"
          icon={settlement.status === "failed" ? ShieldCheckIcon : ReceiptTextIcon}
          info={settlement.info}
          isLast
          label={settlement.label}
          meta={
            preview.error
              ? [
                  {
                    label: "Reason",
                    value: preview.error,
                    wide: true,
                  },
                ]
              : [
                  { label: "Fee", value: preview.estimatedFee },
                  { label: "Network", value: preview.network },
                ]
          }
          privateAmount={Boolean(preview.receipt)}
          status={settlement.status}
          to="Stellar ledger"
        />
      </TimelineSection>
      {position ? <OpenPositionSummary position={position} /> : null}
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
        label="Health factor"
        value={
          metrics.healthFactor === null ? "N/A" : metrics.healthFactor.toFixed(2)
        }
      />
      <MetricTile label="Liquidation" value={liquidationPrice} />
      <MetricTile
        label="Borrow used"
        value={`${Math.round(metrics.utilization * 100)}%`}
      />
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

  return (
    <section className="rounded-lg border bg-success/8 border-success/32 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm text-success">Position open</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            {position.market}
          </p>
        </div>
        <span className="rounded-md border border-success/40 bg-success/12 px-2 py-1 text-success text-xs">
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
        <PositionRow
          label="Health factor"
          value={
            position.healthFactor === null
              ? "N/A"
              : position.healthFactor.toFixed(2)
          }
        />
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
    <div className="flex items-start justify-between gap-3 border-b border-success/16 pb-2 last:border-b-0 last:pb-0">
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

type SettlementCopy = {
  info: string
  label: string
  pendingCaption: string
  status: "active" | "done" | "failed" | "pending"
}

function getSettlementCopy(
  status: BorrowFlowState["transaction"]["status"]
): SettlementCopy {
  if (status === "Confirmed") {
    return {
      info: "Position opened. Receipt hash pinned to the Stellar ledger.",
      label: "Confirmed",
      pendingCaption: "",
      status: "done",
    }
  }
  if (status === "Failed") {
    return {
      info: "Something went wrong. Fix the reason below and try again.",
      label: "Failed",
      pendingCaption: "Not settled",
      status: "failed",
    }
  }
  if (status === "Submitted") {
    return {
      info: "Broadcast to the Soroban RPC. Waiting for ledger inclusion.",
      label: "Awaiting ledger",
      pendingCaption: "Waiting for the next ledger…",
      status: "active",
    }
  }
  if (status === "Signing") {
    return {
      info: "Confirm the transaction in your wallet extension.",
      label: "Signing",
      pendingCaption: "Waiting for wallet signature…",
      status: "active",
    }
  }
  return {
    info: "Signature and settlement will happen after you hit Submit.",
    label: "Ready to submit",
    pendingCaption: "After confirmation",
    status: "pending",
  }
}
