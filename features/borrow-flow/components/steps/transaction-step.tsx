import {
  PenLineIcon,
  ReceiptTextIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { ExternalLink } from "@/components/atoms/external-link"
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
import {
  PositionCard,
  type PositionCardField,
} from "@/components/molecules/position-card"
import { Badge } from "@/components/ui/badge"
import type { MarketCardData } from "@/features/markets"
import { getStellarExpertTxUrl } from "@/features/wallet/network"

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
    () => createTransactionPreview({ account, flow, metrics }),
    [account, flow, metrics]
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
  const healthFactor =
    position.healthFactor === null ? "N/A" : position.healthFactor.toFixed(2)

  const fields: PositionCardField[] = [
    {
      label: "Supplied",
      value: supplied
        ? `${formatAssetAmount(supplied.amount, supplied.symbol)} (${formatUsd(supplied.valueUsd)})`
        : "N/A",
    },
    {
      label: "Borrowed",
      value: borrowed
        ? `${formatAssetAmount(borrowed.amount, borrowed.symbol)} (${formatUsd(borrowed.valueUsd)})`
        : "N/A",
    },
    { label: "Health factor", value: healthFactor },
    {
      label: "Receipt",
      value: (
        <ExternalLink
          className="justify-end font-mono"
          href={getStellarExpertTxUrl(position.receiptHash)}
        >
          <PrivateValue className="truncate">
            {shortHash(position.receiptHash)}
          </PrivateValue>
        </ExternalLink>
      ),
    },
  ]

  return (
    <PositionCard
      badge={<Badge variant="success">{position.status}</Badge>}
      fields={fields}
      subtitle={position.market}
      title="Position open"
    />
  )
}

function shortHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
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
