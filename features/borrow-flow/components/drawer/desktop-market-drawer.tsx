import * as React from "react"

import type { MarketCardData } from "@/app/_constants/dashboard"

import { MARKET_STEPS } from "../../constants"
import { useBorrowFlow } from "../../hooks/use-borrow-flow"
import type { MarketStep } from "../../types"
import { DesktopMarketStepPanel } from "./desktop-market-step-panel"

type DesktopMarketDrawerProps = {
  market: MarketCardData
  onClose: () => void
}

export function DesktopMarketDrawer({
  market,
  onClose,
}: DesktopMarketDrawerProps): React.ReactElement {
  const [activeStep, setActiveStep] = React.useState<MarketStep>("detail")
  const {
    flow,
    metrics,
    refreshTransaction,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  } = useBorrowFlow()

  return (
    <aside className="ml-4 min-w-0 lg:sticky lg:top-0 lg:self-start">
      <div className="relative isolate overflow-hidden rounded-lg lg:h-[calc(100svh-4rem)]">
        {MARKET_STEPS.map((step) => (
          <DesktopMarketStepPanel
            activeStep={activeStep}
            flow={flow}
            key={step}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={setFieldValue}
            onRefreshTransaction={refreshTransaction}
            onSubmit={submitTransaction}
            onStepChange={setActiveStep}
            onVerify={verifyEligibility}
            step={step}
          />
        ))}
      </div>
    </aside>
  )
}
