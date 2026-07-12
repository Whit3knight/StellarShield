import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { MARKET_STEPS } from "../../constants"
import { useShieldedBorrowFlow } from "../../hooks/use-shielded-borrow-flow"
import type { MarketStep } from "../../types"
import { DesktopMarketStepPanel } from "./desktop-market-step-panel"

type DesktopMarketDrawerProps = {
  account: ConnectedAccount | null
  market: MarketCardData
  onClose: () => void
}

export function DesktopMarketDrawer({
  account,
  market,
  onClose,
}: DesktopMarketDrawerProps): React.ReactElement {
  const [activeStep, setActiveStep] = React.useState<MarketStep>("detail")
  const {
    activity,
    flow,
    metrics,
    position,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  } = useShieldedBorrowFlow({ account, market })

  // Whenever the transaction has moved past Ready (Signing / Submitted /
  // Confirmed / Failed), pin the drawer to the review-transaction step.
  // Covers the Submit-click path AND late-mount cases where the footer's
  // synchronous onStepChange didn't win the batching race.
  const shouldPinTransaction =
    flow.transaction.status === "Signing" ||
    flow.transaction.status === "Submitted" ||
    flow.transaction.status === "Confirmed" ||
    flow.transaction.status === "Failed"
  React.useEffect(() => {
    if (!shouldPinTransaction) return
    if (activeStep === "transaction") return
    const raf = window.requestAnimationFrame(() => {
      setActiveStep("transaction")
    })
    return () => window.cancelAnimationFrame(raf)
  }, [shouldPinTransaction, activeStep])

  // Once eligibility verifies, auto-advance to the transaction step and
  // fire submit. The `flow.transaction` object identity churns every
  // render (it lives in `submitTransaction`'s useCallback deps), so
  // guarding the effect on `flow.transaction.status === "Ready"` races
  // with the setState batch that lands Verified + Ready together. Key
  // the ref on the proof id instead — that only bumps once per verify
  // cycle. Empirically the drawer got stuck on the verification step
  // because the tx-status guard was reading a stale render.
  const autoAdvancedProofRef = React.useRef<string | null>(null)
  const verifiedProofId =
    flow.verification.status === "Verified"
      ? flow.verification.proof.id
      : null
  React.useEffect(() => {
    if (!verifiedProofId) return
    if (autoAdvancedProofRef.current === verifiedProofId) return
    autoAdvancedProofRef.current = verifiedProofId
    setActiveStep("transaction")
  }, [verifiedProofId])

  return (
    <aside className="ml-4 hidden min-h-0 min-w-0 lg:block">
      <div className="relative isolate h-full overflow-hidden rounded-lg">
        {MARKET_STEPS.map((step) => (
          <DesktopMarketStepPanel
            activeStep={activeStep}
            account={account}
            activity={activity}
            flow={flow}
            key={step}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={setFieldValue}
            onSubmit={submitTransaction}
            onStepChange={setActiveStep}
            onVerify={verifyEligibility}
            position={position}
            step={step}
          />
        ))}
      </div>
    </aside>
  )
}
