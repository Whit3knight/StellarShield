import type * as React from "react"

import { DrawerFooter } from "@/components/ui/drawer"

import { DESKTOP_FOOTER_CLASS } from "../../constants"
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  MarketStep,
} from "../../types"
import { MarketStepFooterActions } from "./market-step-footer-actions"

type MarketDrawerFooterProps = {
  children: React.ReactNode
}

type DesktopMarketFooterProps = {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  onClose: () => void
  onStepChange: (step: MarketStep) => void
  onSubmit: () => void
  onVerify: () => void
  step: MarketStep
}

export function MarketDrawerFooter({
  children,
}: MarketDrawerFooterProps): React.ReactElement {
  return (
    <DrawerFooter className="w-full flex-row items-center justify-between sm:justify-between">
      {children}
    </DrawerFooter>
  )
}

export function DesktopMarketFooter({
  flow,
  metrics,
  onClose,
  onSubmit,
  onStepChange,
  onVerify,
  step,
}: DesktopMarketFooterProps): React.ReactElement {
  return (
    <div className={DESKTOP_FOOTER_CLASS}>
      <MarketStepFooterActions
        flow={flow}
        metrics={metrics}
        onClose={onClose}
        onStepChange={onStepChange}
        onSubmit={onSubmit}
        onVerify={onVerify}
        step={step}
      />
    </div>
  )
}
