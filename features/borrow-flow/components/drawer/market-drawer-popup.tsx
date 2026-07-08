import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import {
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer"

import type { MarketStep } from "../../types"
import { getStepCopy } from "../../utils"
import { DrawerStepBody } from "./drawer-step-body"
import type { BorrowFlowStepProps } from "./types"

type MarketDrawerPopupProps = BorrowFlowStepProps & {
  children: React.ReactNode
  step: MarketStep
}

export function MarketDrawerPopup({
  children,
  flow,
  market,
  metrics,
  onFieldChange,
  onRefreshTransaction,
  step,
}: MarketDrawerPopupProps): React.ReactElement {
  const stepCopy = getStepCopy(market, step)

  return (
    <DrawerPopup showBar>
      <DrawerHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <DrawerTitle>{stepCopy.title}</DrawerTitle>
            <DrawerDescription className="mt-2">
              {stepCopy.description}
            </DrawerDescription>
          </div>
          <Badge variant="outline">{market.risk}</Badge>
        </div>
      </DrawerHeader>

      <DrawerPanel className="space-y-5" hideScrollbar scrollFade>
        <DrawerStepBody
          flow={flow}
          market={market}
          metrics={metrics}
          onFieldChange={onFieldChange}
          onRefreshTransaction={onRefreshTransaction}
          step={step}
        />
      </DrawerPanel>

      {children}
    </DrawerPopup>
  )
}
