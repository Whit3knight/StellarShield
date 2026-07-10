import { ArrowLeftIcon, ArrowRightIcon, WalletIcon } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { useNavMenus } from "@/app/_hooks/use-nav-menus"

import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  MarketStep,
} from "../../types"
import { canSubmitTransaction } from "../../flow-actions"
import { isSubmitPending, isVerificationPending } from "../../steps"

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
  const { connectDialog } = useNavMenus()

  if (step === "verification") {
    const isChecking = isVerificationPending(flow.verification.status)
    const isSubmitting = isSubmitPending(flow.transaction)
    const canSubmit = canSubmitTransaction({
      metrics,
      status: flow.verification.status,
      transaction: flow.transaction,
    })
    const verificationLabel = canSubmit
      ? isSubmitting
        ? flow.transaction.status
        : "Submit transaction"
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
          disabled={isChecking || isSubmitting || !metrics.isLoanValid}
          loading={isChecking || isSubmitting}
          onClick={() => {
            if (canSubmit) {
              onSubmit()
              return
            }

            onVerify()
          }}
          type="button"
        >
          {verificationLabel}
          {!canSubmit || isSubmitting ? null : (
            <ArrowRightIcon aria-hidden="true" />
          )}
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
      {metrics.hasWallet ? (
        <Button
          onClick={() => {
            onStepChange("collateral")
          }}
          type="button"
        >
          Start borrow
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      ) : (
        <Button
          onClick={() => connectDialog.setOpen(true)}
          type="button"
        >
          <WalletIcon aria-hidden="true" />
          Connect wallet
        </Button>
      )}
    </>
  )
}
