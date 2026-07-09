import {
  FileCheckIcon,
  LandmarkIcon,
  LockIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { getMarketPair, type MarketCardData } from "@/features/markets"

import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { formatAssetAmount, formatUsd } from "../../utils"
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
  const proofExpiresAt = flow.proof
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(flow.proof.expiresAt))
    : "After verification"
  const verificationStatus = getVerificationTimelineStatus(
    flow.verificationStatus
  )
  const borrowIntentStatus = flow.borrowIntent
    ? "done"
    : flow.verificationStatus === "Verified"
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
            label: "Data scope",
            value: "Local only",
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
        amount={flow.verificationStatus}
        from="Local proof"
        icon={LockIcon}
        info="The private proof is prepared locally, then only the proof result is used for protocol simulation."
        label="Proof generation"
        meta={[
          {
            label: "Proof claim",
            value: flow.proof?.claim ?? "Not generated",
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
        amount={flow.borrowIntent?.id ?? "Prepared after verification"}
        from="Verified proof"
        icon={FileCheckIcon}
        info="The borrow intent binds the verified proof, market pair, and requested amounts before transaction review."
        isLast
        label="Borrow intent"
        meta={[
          {
            label: "Simulation",
            value: flow.simulationStatus,
          },
          {
            label: "Loan health",
            value: metrics.loanHealth,
          },
          {
            label: "Public inputs",
            value:
              flow.proof === null
                ? "Prepared after verification"
                : `HF >= ${flow.proof.publicInputs.healthFactorMin}, LTV ${flow.proof.publicInputs.maxLtv}`,
            wide: true,
          },
        ]}
        privateAmount={Boolean(flow.borrowIntent)}
        status={borrowIntentStatus}
        to="Review transaction"
      />
    </TimelineSection>
  )
}

function getVerificationTimelineStatus(
  status: BorrowFlowState["verificationStatus"]
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
