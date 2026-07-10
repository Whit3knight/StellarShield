import {
  PenLineIcon,
  ReceiptTextIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
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

type RowStatus = "active" | "done" | "failed" | "pending"

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
  const rows = getTimelineRows(flow.transaction.status)
  const signingCopy = getSigningCopy(rows.signing)
  const settleCopy = getSettleCopy(rows.settle)

  return (
    <>
      {position ? null : <RiskSummary market={market} metrics={metrics} />}
      <TimelineSection>
        <TimelineItem
          from="Wallet"
          icon={pickSigningIcon(rows.signing)}
          info={signingCopy.info}
          label={signingCopy.label}
          meta={[{ label: "Fee", value: preview.estimatedFee }]}
          status={rows.signing}
          to="Wallet signature"
        />
        <TimelineItem
          amount={preview.receipt ?? settleCopy.pendingCaption}
          from="Wallet signature"
          icon={pickSettleIcon(rows.settle)}
          info={settleCopy.info}
          isLast
          label={settleCopy.label}
          meta={
            preview.error
              ? [{ label: "Reason", value: preview.error, wide: true }]
              : [{ label: "Network", value: preview.network }]
          }
          privateAmount={Boolean(preview.receipt)}
          status={rows.settle}
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
    <section className="rounded-lg border bg-background/72 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm">Position open</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            {position.market}
          </p>
        </div>
        <Badge variant="success">{position.status}</Badge>
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
        <PositionRow label="Receipt" privateValue value={shortHash(position.receiptHash)} />
      </div>
    </section>
  )
}

function shortHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
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

function getTimelineRows(
  status: BorrowFlowState["transaction"]["status"]
): { signing: RowStatus; settle: RowStatus } {
  if (status === "Confirmed") return { settle: "done", signing: "done" }
  if (status === "Submitted") return { settle: "active", signing: "done" }
  if (status === "Signing") return { settle: "pending", signing: "active" }
  if (status === "Failed") return { settle: "failed", signing: "failed" }
  return { settle: "pending", signing: "pending" }
}

function pickSigningIcon(status: RowStatus): LucideIcon {
  if (status === "failed") return ShieldAlertIcon
  if (status === "done") return ShieldCheckIcon
  return PenLineIcon
}

function pickSettleIcon(status: RowStatus): LucideIcon {
  if (status === "failed") return ShieldAlertIcon
  if (status === "done") return ShieldCheckIcon
  return ReceiptTextIcon
}

function getSigningCopy(status: RowStatus): { info: string; label: string } {
  if (status === "done") {
    return { info: "Wallet signed the transaction.", label: "Signed" }
  }
  if (status === "active") {
    return {
      info: "Confirm the transaction in your wallet extension.",
      label: "Signing",
    }
  }
  if (status === "failed") {
    return {
      info: "Signing did not complete. See reason below.",
      label: "Signing failed",
    }
  }
  return {
    info: "Wallet will be prompted after you hit Submit.",
    label: "Sign",
  }
}

function getSettleCopy(status: RowStatus): {
  info: string
  label: string
  pendingCaption: string
} {
  if (status === "done") {
    return {
      info: "Position opened. Receipt hash pinned to the Stellar ledger.",
      label: "Confirmed",
      pendingCaption: "",
    }
  }
  if (status === "active") {
    return {
      info: "Broadcast to the Soroban RPC. Waiting for ledger inclusion.",
      label: "Awaiting ledger",
      pendingCaption: "Waiting for the next ledger…",
    }
  }
  if (status === "failed") {
    return {
      info: "Something went wrong. Fix the reason below and try again.",
      label: "Not settled",
      pendingCaption: "Not settled",
    }
  }
  return {
    info: "Ledger settlement happens after signing.",
    label: "Confirm",
    pendingCaption: "After signing",
  }
}
