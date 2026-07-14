import { ArrowLeftIcon, ArrowRightIcon, WalletIcon } from "lucide-react"
import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { useNavMenus } from "@/app/_hooks/use-nav-menus"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerTrigger } from "@/components/ui/drawer"
import type { MarketCardData } from "@/features/markets"

import { useShieldedBorrowFlow } from "../../hooks/use-shielded-borrow-flow"
import { shouldShowTransaction } from "../../gates"
import { isSubmitPending, isVerificationPending } from "../../steps"
import { MarketDrawerFooter } from "./market-drawer-footer"
import { MarketDrawerPopup } from "./market-drawer-popup"
import type { BorrowFlowDrawerProps } from "./types"

function MobileDrawerBackButton(): React.ReactElement {
  return (
    <DrawerClose render={<Button type="button" variant="ghost" />}>
      <ArrowLeftIcon aria-hidden="true" />
      Back
    </DrawerClose>
  )
}

function MobileTransactionDrawer({
  account,
  activity,
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
  position,
}: Omit<BorrowFlowDrawerProps, "onVerify">): React.ReactElement {
  const isSubmitting = isSubmitPending(flow.transaction)
  const isReady = flow.transaction.status === "Ready"
  const isFailed = flow.transaction.status === "Failed"
  const isConfirmed = flow.transaction.status === "Confirmed"

  // This component only mounts once eligibility verifies (its parent
  // `MobileVerificationDrawer` conditionally renders it on
  // `canSubmit`). Auto-open the drawer on mount so mobile users land
  // on step 4 without an extra tap; the Submit button inside the
  // drawer body handles the actual signing.
  const [open, setOpen] = React.useState(false)
  const openedRef = React.useRef(false)
  React.useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    setOpen(true)
  }, [])

  return (
    <Drawer onOpenChange={setOpen} open={open}>
      <DrawerTrigger
        disabled={isSubmitting}
        render={<Button loading={isSubmitting} type="button" />}
      >
        {isSubmitting ? flow.transaction.status : "Submit transaction"}
      </DrawerTrigger>
      <MarketDrawerPopup
        account={account}
        activity={activity}
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        position={position}
        step="transaction"
      >
        <MarketDrawerFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Close
          </Button>
          {isFailed ? (
            <Button onClick={onSubmit} type="button">
              Retry submission
            </Button>
          ) : isReady || isSubmitting ? (
            <Button
              disabled={isSubmitting}
              loading={isSubmitting}
              onClick={onSubmit}
              type="button"
            >
              {isSubmitting ? flow.transaction.status : "Submit transaction"}
            </Button>
          ) : (
            <Button disabled={!isConfirmed} onClick={onClose} type="button">
              Done
            </Button>
          )}
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileVerificationDrawer({
  account,
  activity,
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
  onVerify,
  position,
}: BorrowFlowDrawerProps): React.ReactElement {
  const isChecking = isVerificationPending(flow.verification.status)
  // Keep the transaction drawer mounted once the tx leaves Draft —
  // gating the mount on `canSubmit` alone unmounted it the moment
  // Submit flipped the status to Signing, bouncing the user back to
  // the verification step mid-submit.
  const showTransaction = shouldShowTransaction({
    metrics,
    status: flow.verification.status,
    transaction: flow.transaction,
  })

  return (
    <Drawer>
      <DrawerTrigger
        render={<Button disabled={!metrics.isLoanValid} type="button" />}
      >
        Continue
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        account={account}
        activity={activity}
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        position={position}
        step="verification"
      >
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          {showTransaction ? (
            <MobileTransactionDrawer
              account={account}
              activity={activity}
              flow={flow}
              market={market}
              metrics={metrics}
              onClose={onClose}
              onFieldChange={onFieldChange}
              onSubmit={onSubmit}
              position={position}
            />
          ) : (
            <Button
              disabled={isChecking || !metrics.isLoanValid}
              loading={isChecking}
              onClick={onVerify}
              type="button"
            >
              Verify eligibility
            </Button>
          )}
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileCollateralDrawer(
  props: BorrowFlowDrawerProps
): React.ReactElement {
  const { connectDialog } = useNavMenus()

  if (!props.metrics.hasWallet) {
    return (
      <Button onClick={() => connectDialog.setOpen(true)} type="button">
        <WalletIcon aria-hidden="true" />
        Connect wallet
      </Button>
    )
  }

  return (
    <Drawer>
      <DrawerTrigger render={<Button type="button" />}>
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup {...props} step="collateral">
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          <MobileVerificationDrawer {...props} />
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

type MobileMarketDrawerProps = {
  account: ConnectedAccount | null
  market: MarketCardData
  onClose: () => void
}

export function MobileMarketDrawer({
  account,
  market,
  onClose,
}: MobileMarketDrawerProps): React.ReactElement {
  const {
    activity,
    flow,
    metrics,
    position,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  } = useShieldedBorrowFlow({ account, market })

  const drawerProps = {
    account,
    activity,
    flow,
    market,
    metrics,
    onClose,
    onFieldChange: setFieldValue,
    onSubmit: submitTransaction,
    onVerify: verifyEligibility,
    position,
  } satisfies BorrowFlowDrawerProps

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <MarketDrawerPopup {...drawerProps} step="detail">
        <MarketDrawerFooter>
          <DrawerClose render={<Button type="button" variant="ghost" />}>
            Close
          </DrawerClose>
          <MobileCollateralDrawer {...drawerProps} />
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}
