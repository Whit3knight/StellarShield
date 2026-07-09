import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerTrigger } from "@/components/ui/drawer"
import type { MarketCardData } from "@/features/markets"

import { useBorrowFlow } from "../../hooks/use-borrow-flow"
import { canSubmitTransaction, isVerificationPending } from "../../utils"
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
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onRefreshTransaction,
  onSubmit,
}: Omit<BorrowFlowDrawerProps, "onVerify">): React.ReactElement {
  return (
    <Drawer>
      <DrawerTrigger onClick={onSubmit} render={<Button type="button" />}>
        Submit transaction
      </DrawerTrigger>
      <MarketDrawerPopup
        account={account}
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        onRefreshTransaction={onRefreshTransaction}
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
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onRefreshTransaction,
  onSubmit,
  onVerify,
}: BorrowFlowDrawerProps): React.ReactElement {
  const isChecking = isVerificationPending(flow.verificationStatus)
  const canSubmit = canSubmitTransaction({
    metrics,
    status: flow.verificationStatus,
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
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        onRefreshTransaction={onRefreshTransaction}
        step="verification"
      >
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          {canSubmit ? (
            <MobileTransactionDrawer
              account={account}
              flow={flow}
              market={market}
              metrics={metrics}
              onClose={onClose}
              onFieldChange={onFieldChange}
              onRefreshTransaction={onRefreshTransaction}
              onSubmit={onSubmit}
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
  return (
    <Drawer>
      <DrawerTrigger
        render={<Button disabled={!props.metrics.hasWallet} type="button" />}
      >
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
    flow,
    metrics,
    refreshTransaction,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  } = useBorrowFlow({ account, market })

  const drawerProps = {
    account,
    flow,
    market,
    metrics,
    onClose,
    onFieldChange: setFieldValue,
    onRefreshTransaction: refreshTransaction,
    onSubmit: submitTransaction,
    onVerify: verifyEligibility,
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
