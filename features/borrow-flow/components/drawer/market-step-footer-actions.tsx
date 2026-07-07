import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"

import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  MarketStep,
} from "../../types"

type MarketStepFooterActionsProps = {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  onClose: () => void
  onStepChange: (step: MarketStep) => void
  onSubmit: () => void
  onVerify: () => void
  step: MarketStep
}

export function MarketStepFooterActions({
  flow,
  metrics,
  onClose,
  onStepChange,
  onSubmit,
  onVerify,
  step,
}: MarketStepFooterActionsProps): React.ReactElement {
  if (step === "transaction") {
    return (
      <>
        <Button onClick={onClose} type="button" variant="ghost">
          Close
        </Button>
        <Button onClick={onClose} type="button">
          Done
        </Button>
      </>
    )
  }

  if (step === "verification") {
    const isChecking = flow.verificationStatus === "Checking"
    const isVerified = flow.verificationStatus === "Verified"

    return (
      <>
        <Button
          onClick={() => {
            onStepChange("collateral")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          disabled={isChecking || !metrics.isLoanValid}
          loading={isChecking}
          onClick={() => {
            if (isVerified) {
              onSubmit()
              onStepChange("transaction")
              return
            }

            onVerify()
          }}
          type="button"
        >
          {isVerified ? "Submit transaction" : "Verify eligibility"}
          {!isVerified ? null : <ArrowRightIcon aria-hidden="true" />}
        </Button>
      </>
    )
  }

  if (step === "collateral") {
    return (
      <>
        <Button
          onClick={() => {
            onStepChange("detail")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          disabled={!metrics.isLoanValid}
          onClick={() => {
            onStepChange("verification")
          }}
          type="button"
        >
          Continue
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </>
    )
  }

  return (
    <>
      <Button onClick={onClose} type="button" variant="ghost">
        Close
      </Button>
      <Button
        onClick={() => {
          onStepChange("collateral")
        }}
        type="button"
      >
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </>
  )
}
