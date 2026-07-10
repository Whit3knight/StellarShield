import type * as React from "react"

import type { MarketStep } from "../../types"
import { BorrowTermsStep } from "../steps/borrow-terms-step"
import { MarketDetailStep } from "../steps/market-detail-step"
import { VerificationStep } from "../steps/verification-step"
import type { BorrowFlowStepProps } from "./types"

type DrawerStepBodyProps = BorrowFlowStepProps & {
  step: MarketStep
}

export function DrawerStepBody({
  account,
  flow,
  market,
  metrics,
  onFieldChange,
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

  return <MarketDetailStep account={account} market={market} />
}
