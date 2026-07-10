import {
  FileCheckIcon,
  LandmarkIcon,
  LockIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { getMarketPair, type MarketCardData } from "@/features/markets"
import { formatAdapterError } from "@/features/protocol"

import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  VerificationStatus,
} from "../../types"
import { getIntent, getProof } from "../../types"
import { formatAssetAmount, formatUsd } from "../../format"
import { TimelineItem, TimelineSection } from "../flow-timeline"

type VerificationStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}

export function VerificationStep({
  account,
  flow,
  market,
  metrics,
}: VerificationStepProps): React.ReactElement {
  const accountLabel = account?.wallet.shortAddress ?? "Connect wallet"
  const availableCollateral = account
    ? formatAssetAmount(metrics.collateralWalletBalance, market.collateral)
    : "Connect wallet"
  const collateralAmount = formatAssetAmount(
    metrics.collateralAmount,
    market.collateral
  )
  const loanAmount = formatAssetAmount(metrics.loanAmount, market.symbol)
  const proof = getProof(flow.verification)
  const proofExpiresAt = proof
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(proof.expiresAt))
    : "After verification"
  const verificationStatus = getVerificationTimelineStatus(
    flow.verification.status
  )
  const intent = getIntent(flow.transaction)
  const simulationLabel = getSimulationLabel(flow.transaction.status)
  const borrowIntentStatus = intent
    ? "done"
    : flow.verification.status === "Verified"
      ? "active"
      : "pending"

  return (
    <TimelineSection>
      <TimelineItem
        amount={availableCollateral}
        from={accountLabel}
        icon={WalletIcon}
        info="Wallet balance and address are read locally before proof generation."
        label="Wallet check"
        meta={[
          {
            label: "Market",
            value: getMarketPair(market),
          },
          {
            label: "Privacy",
            value: "Nothing leaves this device",
          },
        ]}
        privateAmount={Boolean(account)}
        privateFrom
        status={account ? "done" : "pending"}
        to="Local prover"
      />
      <TimelineItem
        amount={`${collateralAmount} -> ${loanAmount}`}
        from={`${market.collateral} collateral`}
        icon={LandmarkIcon}
        info="Collateral and loan amount are checked against wallet balance, minimum size, and current borrowing power."
        label="Market inputs"
        meta={[
          {
            label: "Borrowing power",
            value: formatUsd(metrics.borrowingPower),
          },
          {
            label: "Loan health",
            value: metrics.loanHealth,
          },
        ]}
        status={metrics.isLoanValid ? "done" : account ? "active" : "pending"}
        to={`${market.symbol} borrow`}
      />
      <TimelineItem
        amount={flow.verification.status}
        from="Local proof"
        icon={LockIcon}
        info={
          flow.verification.status === "Failed" && flow.verification.error
            ? `Proof step failed: ${formatAdapterError(flow.verification.error)}`
            : "The private proof is prepared locally, then only the proof result is used for protocol simulation."
        }
        label="Proof generation"
        meta={[
          {
            label: "Proof claim",
            value: proof?.claim ?? "Not generated",
            wide: true,
          },
          {
            label: "Expires",
            value: proofExpiresAt,
          },
        ]}
        status={verificationStatus}
        to="Protocol simulation"
      />
      <TimelineItem
        amount={intent?.id ?? "Prepared after verification"}
        from="Verified proof"
        icon={FileCheckIcon}
        info="The borrow intent binds the verified proof, market pair, and requested amounts before transaction review."
        isLast
        label="Borrow intent"
        meta={[
          {
            label: "Simulation",
            value: simulationLabel,
          },
          {
            label: "Loan health",
            value: metrics.loanHealth,
          },
          {
            label: "Public inputs",
            value:
              proof === null
                ? "Prepared after verification"
                : `HF >= ${proof.publicInputs.healthFactorMin}, LTV ${proof.publicInputs.maxLtv}`,
            wide: true,
          },
        ]}
        privateAmount={Boolean(intent)}
        status={borrowIntentStatus}
        to="Review transaction"
      />
    </TimelineSection>
  )
}

function getSimulationLabel(status: BorrowFlowState["transaction"]["status"]): string {
  if (status === "Ready") return "Ready"
  if (status === "Draft") return "Idle"
  return "Simulating"
}

function getVerificationTimelineStatus(
  status: VerificationStatus
): "active" | "done" | "failed" | "pending" {
  if (status === "Verified") {
    return "done"
  }

  if (status === "Failed" || status === "Expired") {
    return "failed"
  }

  if (status === "Preparing" || status === "Generating proof") {
    return "active"
  }

  return "pending"
}
