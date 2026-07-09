import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"

import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  MarketStep,
} from "../../types"
import { canSubmitTransaction } from "../../flow-actions"
import { isVerificationPending } from "../../steps"

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
    const isChecking = isVerificationPending(flow.verification.status)
    const canSubmit = canSubmitTransaction({
      metrics,
      status: flow.verification.status,
      transaction: flow.transaction,
    })
    const verificationLabel = canSubmit
      ? "Submit transaction"
      : isChecking
        ? flow.verification.status
        : flow.verification.status === "Failed"
          ? "Retry verification"
          : "Verify eligibility"

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
            if (canSubmit) {
              onSubmit()
              onStepChange("transaction")
              return
            }

            onVerify()
          }}
          type="button"
        >
          {verificationLabel}
          {!canSubmit ? null : <ArrowRightIcon aria-hidden="true" />}
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
        disabled={!metrics.hasWallet}
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
