import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { useNavMenus } from "@/app/_hooks/use-nav-menus"
import type { MarketCardData } from "@/features/markets"

import { MARKET_STEPS } from "../../constants"
import { useBorrowFlow } from "../../hooks/use-borrow-flow"
import type { MarketStep } from "../../types"
import { DesktopMarketStepPanel } from "./desktop-market-step-panel"

// After a confirmed borrow, hold on the receipt for a moment so the
// user reads the success card + toast, then close the market drawer
// and pop open the Positions drawer.
const CONFIRMED_CLOSE_DELAY_MS = 2_500

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

  const { positionsDrawer } = useNavMenus()

  // Latch the callbacks in refs so the confirmed handoff effect only
  // depends on the transaction status. Otherwise a new onClose or
  // positionsDrawer object each render would keep resetting the
  // timer and it would never fire.
  const onCloseRef = React.useRef(onClose)
  const positionsDrawerRef = React.useRef(positionsDrawer)
  React.useEffect(() => {
    onCloseRef.current = onClose
    positionsDrawerRef.current = positionsDrawer
  })

  // On Confirmed: hand off the flow to the Positions drawer. Fires
  // once per unique receipt hash so re-renders don't re-open.
  const handedOffHashRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (flow.transaction.status !== "Confirmed") return
    const hash = flow.transaction.receipt.hash
    if (handedOffHashRef.current === hash) return
    handedOffHashRef.current = hash

    const timer = window.setTimeout(() => {
      positionsDrawerRef.current.setOpen(true)
      onCloseRef.current()
    }, CONFIRMED_CLOSE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [flow.transaction])

  // Auto-advance the drawer step to keep in sync with the flow state.
  // When verification lands as Verified + transaction becomes Ready,
  // jump the drawer to the transaction review step so the user does
  // not have to hunt for the Submit action. Schedule the setState via
  // requestAnimationFrame so React does not warn about cascading
  // renders inside an effect.
  React.useEffect(() => {
    if (
      flow.verification.status !== "Verified" ||
      flow.transaction.status !== "Ready"
    ) {
      return
    }
    if (activeStep !== "collateral" && activeStep !== "verification") {
      return
    }
    const raf = window.requestAnimationFrame(() => {
      setActiveStep("transaction")
    })
    return () => window.cancelAnimationFrame(raf)
  }, [flow.verification.status, flow.transaction.status, activeStep])

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
