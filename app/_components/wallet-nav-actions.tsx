"use client"

import * as React from "react"

import { ActivityDrawer } from "@/components/organisms/activity-drawer"
import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { PositionsDrawer } from "@/components/organisms/positions-drawer"
import { ProofsDrawer } from "@/components/organisms/proofs-drawer"
import { useBorrowSession } from "@/features/borrow-flow/session-store"
import { useMergedActivities } from "@/features/borrow-flow/use-chain-activities"
import { useChainPositions } from "@/features/borrow-flow/use-chain-positions"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"

import { walletProviders, type WalletProvider } from "../_constants/account"
import { useNavMenus } from "../_hooks/use-nav-menus"
import { NotificationMenu } from "./notification-menu"
import { UserMenu } from "./user-menu"

export function WalletNavActions(): React.ReactElement {
  const {
    account,
    cancelPendingConnection,
    connect,
    disconnect,
    error,
    pendingProviderId,
  } = useWalletConnection()
  const { connectDialog } = useNavMenus()

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      connectDialog.setOpen(nextOpen)

      if (!nextOpen) {
        cancelPendingConnection()
      }
    },
    [cancelPendingConnection, connectDialog]
  )

  const handleConnect = React.useCallback(
    async (provider: WalletProvider) => {
      const connected = await connect(provider)

      if (connected) {
        connectDialog.setOpen(false)
      }
    },
    [connect, connectDialog]
  )

  return (
    <>
      {account ? (
        <>
          <NotificationMenu />
          <UserMenu account={account} onDisconnect={disconnect} />
        </>
      ) : (
        <ConnectWalletDialog
          error={error}
          onConnect={handleConnect}
          onOpenChange={handleOpenChange}
          open={connectDialog.open}
          pendingProviderId={pendingProviderId}
          providers={walletProviders}
        />
      )}
      <SessionDrawers account={account?.wallet.address ?? null} />
    </>
  )
}

function SessionDrawers({
  account,
}: {
  account: string | null
}): React.ReactElement {
  const { activityDrawer, positionsDrawer, proofsDrawer } = useNavMenus()
  const { proofs } = useBorrowSession()
  // Positions drawer reads from `useNotes()` now, but the activity
  // drawer still merges legacy chain receipts with client-side proof
  // history, so the chain read stays gated on the activity drawer.
  const chainReadEnabled = activityDrawer.open
  const { receipts: chainPositions } = useChainPositions(
    account,
    chainReadEnabled
  )
  const activities = useMergedActivities({
    chainReceipts: chainPositions,
    proofs,
  })

  return (
    <>
      <ActivityDrawer
        activities={activities}
        onOpenChange={activityDrawer.setOpen}
        open={activityDrawer.open}
      />
      <PositionsDrawer
        onOpenChange={positionsDrawer.setOpen}
        open={positionsDrawer.open}
      />
      <ProofsDrawer
        onOpenChange={proofsDrawer.setOpen}
        open={proofsDrawer.open}
        proofs={proofs}
      />
    </>
  )
}
