import {
  ActivityIcon,
  ClockIcon,
  FileCheckIcon,
  HeartPulseIcon,
  LandmarkIcon,
  LockIcon,
  RouteIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { getMarketPair, type MarketCardData } from "@/features/markets"

import { SummaryRow, SummarySection, TransferRoute } from "../summary-list"
import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { formatAssetAmount, formatUsd } from "../../utils"

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

  return (
    <>
      <SummarySection
        description="Sensitive wallet data stays local; only public proof inputs continue."
        icon={ShieldCheckIcon}
        title="Privacy route"
      >
        <TransferRoute
          amount={getMarketPair(market)}
          description="Wallet balances are checked before proof generation."
          from={accountLabel}
          icon={WalletIcon}
          label="Wallet check"
          privateFrom
          to="Local prover"
        />
        <TransferRoute
          amount={flow.simulationStatus}
          description="Only proof status and market inputs are passed forward."
          from="Local proof"
          icon={LockIcon}
          label="Proof output"
          to="Protocol simulation"
        />
      </SummarySection>

      <SummarySection
        description="Amounts used to decide whether this borrow request is eligible."
        icon={RouteIcon}
        title="Market inputs"
      >
        <SummaryRow
          icon={LandmarkIcon}
          label="Market"
          value={getMarketPair(market)}
        />
        <SummaryRow
          icon={WalletIcon}
          label="Available collateral"
          privateValue
          value={availableCollateral}
        />
        <SummaryRow
          icon={LockIcon}
          label="Collateral"
          value={collateralAmount}
        />
        <SummaryRow
          icon={LandmarkIcon}
          label="Loan amount"
          value={loanAmount}
        />
        <SummaryRow
          icon={ActivityIcon}
          label="Borrowing power"
          value={formatUsd(metrics.borrowingPower)}
        />
      </SummarySection>

      <SummarySection
        description="Result prepared for transaction simulation and final review."
        icon={FileCheckIcon}
        title="Proof result"
      >
        <SummaryRow
          icon={ShieldCheckIcon}
          label="Private verification"
          value={flow.verificationStatus}
        />
        <SummaryRow
          icon={FileCheckIcon}
          label="Proof claim"
          value={flow.proof?.claim ?? "Not generated"}
        />
        <SummaryRow
          icon={RouteIcon}
          label="Borrow intent"
          privateValue
          value={flow.borrowIntent?.id ?? "Prepared after verification"}
        />
        <SummaryRow icon={ClockIcon} label="Expires" value={proofExpiresAt} />
        <SummaryRow
          icon={HeartPulseIcon}
          label="Loan health"
          value={metrics.loanHealth}
        />
      </SummarySection>
    </>
  )
}
