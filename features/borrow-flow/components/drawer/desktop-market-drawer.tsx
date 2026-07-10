import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { MARKET_STEPS } from "../../constants"
import { useBorrowFlow } from "../../hooks/use-borrow-flow"
import { useConfirmedClose } from "../../hooks/use-confirmed-close"
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

  useConfirmedClose(flow.transaction, onClose)

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
