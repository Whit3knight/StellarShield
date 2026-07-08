import type * as React from "react"

import { Badge } from "@/components/ui/badge"

import {
  DESKTOP_STACK_PEEK_PX,
  DESKTOP_STACK_RAIL_PX,
  DESKTOP_STACK_SCALE_STEP,
} from "../../constants"
import type { MarketStep } from "../../types"
import { getStepCopy, getStepIndex } from "../../utils"
import { DrawerStepBody } from "./drawer-step-body"
import { DesktopMarketFooter } from "./market-drawer-footer"
import type { BorrowFlowDrawerProps } from "./types"

type DesktopMarketStepPanelProps = BorrowFlowDrawerProps & {
  activeStep: MarketStep
  onStepChange: (step: MarketStep) => void
  step: MarketStep
}

export function DesktopMarketStepPanel({
  activeStep,
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onRefreshTransaction,
  onSubmit,
  onStepChange,
  onVerify,
  step,
}: DesktopMarketStepPanelProps): React.ReactElement {
  const activeIndex = getStepIndex(activeStep)
  const stepIndex = getStepIndex(step)
  const depth = activeIndex - stepIndex
  const isActive = depth === 0
  const isBehind = depth > 0
  const stepCopy = getStepCopy(market, step)
  const scale = Math.max(0.86, 1 - depth * DESKTOP_STACK_SCALE_STEP)
  const transform = isBehind
    ? `translateX(-${depth * DESKTOP_STACK_PEEK_PX}px) scale(${scale})`
    : depth < 0
      ? "translateX(calc(100% + 1px))"
      : "translateX(0) scale(1)"

  return (
    <section
      aria-hidden={!isActive}
      className="absolute inset-y-0 right-0 flex max-w-none min-w-0 origin-left flex-col overflow-hidden rounded-s-2xl border-s bg-popover text-popover-foreground shadow-lg/5 transition-[transform,opacity,box-shadow,background-color] duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-s-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
      inert={isActive ? undefined : true}
      style={{
        opacity: depth < -1 ? 0 : 1,
        transform,
        width: `calc(100% - ${DESKTOP_STACK_RAIL_PX}px)`,
        zIndex: 20 + stepIndex,
      }}
    >
      <div className="flex flex-col gap-2 p-6 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl leading-none font-semibold">
              {stepCopy.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {stepCopy.description}
            </p>
          </div>
          <Badge variant="outline">{market.risk}</Badge>
        </div>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-6 pt-1">
        <div className="space-y-5">
          <DrawerStepBody
            flow={flow}
            market={market}
            metrics={metrics}
            onFieldChange={onFieldChange}
            onRefreshTransaction={onRefreshTransaction}
            step={step}
          />
        </div>
      </div>

      <DesktopMarketFooter
        flow={flow}
        metrics={metrics}
        onClose={onClose}
        onSubmit={onSubmit}
        onStepChange={onStepChange}
        onVerify={onVerify}
        step={step}
      />
    </section>
  )
}
