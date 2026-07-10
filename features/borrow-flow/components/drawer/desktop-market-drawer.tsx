import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { MARKET_STEPS } from "../../constants"
import { useBorrowFlow } from "../../hooks/use-borrow-flow"
import { useConfirmedHandoff } from "../../hooks/use-confirmed-handoff"
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
  } = useBorrowFlow({ account, market })

  useConfirmedHandoff(flow.transaction, onClose)

  // When the user hits Submit the verification step's footer routes
  // step to `transaction` explicitly. When the tx moves past Ready
  // (Signing / Submitted / Confirmed), keep the drawer pinned to the
  // review step so the user always sees the receipt as it lands.
  const priorTxStatusRef = React.useRef(flow.transaction.status)
  React.useEffect(() => {
    const prev = priorTxStatusRef.current
    const next = flow.transaction.status
    priorTxStatusRef.current = next

    if (
      prev === "Ready" &&
      (next === "Signing" || next === "Submitted") &&
      activeStep !== "transaction"
    ) {
      setActiveStep("transaction")
    }
  }, [flow.transaction.status, activeStep])

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
