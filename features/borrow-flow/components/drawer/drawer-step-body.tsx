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
  flow,
  market,
  metrics,
  onFieldChange,
  onRefreshTransaction,
  step,
}: DrawerStepBodyProps): React.ReactElement {
  if (step === "collateral") {
    return (
      <BorrowTermsStep
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
      />
    )
  }

  if (step === "verification") {
    return <VerificationStep flow={flow} market={market} metrics={metrics} />
  }

  if (step === "transaction") {
    return (
      <TransactionStep
        flow={flow}
        market={market}
        metrics={metrics}
        onRefreshTransaction={onRefreshTransaction}
      />
    )
  }

  return <MarketDetailStep market={market} />
}
