import type * as React from "react"

import type { MarketStep } from "../../types"
import { BorrowTermsStep } from "../steps/borrow-terms-step"
import { MarketDetailStep } from "../steps/market-detail-step"
import { TransactionStep } from "../steps/transaction-step"
import { VerificationStep } from "../steps/verification-step"
import type { BorrowFlowStepProps } from "./types"

type DrawerStepBodyProps = BorrowFlowStepProps & {
  step: MarketStep
}

export function DrawerStepBody({
  account,
  activity,
  flow,
  market,
  metrics,
  onFieldChange,
  position,
  step,
}: DrawerStepBodyProps): React.ReactElement {
  if (step === "collateral") {
    return (
      <BorrowTermsStep
        account={account}
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
      />
    )
  }

  if (step === "verification") {
    return (
      <VerificationStep
        account={account}
        flow={flow}
        market={market}
        metrics={metrics}
      />
    )
  }

  if (step === "transaction") {
    return (
      <TransactionStep
        account={account}
        activity={activity}
        flow={flow}
        market={market}
        metrics={metrics}
        position={position}
      />
    )
  }

  return <MarketDetailStep account={account} market={market} />
}
