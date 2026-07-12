import { ArrowLeftIcon, ArrowRightIcon, WalletIcon } from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { useNavMenus } from "@/app/_hooks/use-nav-menus"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerTrigger } from "@/components/ui/drawer"
import type { MarketCardData } from "@/features/markets"

import { useShieldedBorrowFlow } from "../../hooks/use-shielded-borrow-flow"
import { canSubmitTransaction } from "../../gates"
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

  return (
    <Drawer>
      <DrawerTrigger
        disabled={isSubmitting}
        onClick={onSubmit}
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
          <Button onClick={onClose} type="button">
            Done
          </Button>
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
  const canSubmit = canSubmitTransaction({
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
          {canSubmit ? (
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
