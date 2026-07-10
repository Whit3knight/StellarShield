"use client"

import * as React from "react"

import { ActivityDrawer } from "@/components/organisms/activity-drawer"
import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { ProofsDrawer } from "@/components/organisms/proofs-drawer"
import { useBorrowSession } from "@/features/borrow-flow/session-store"
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
      <SessionDrawers />
    </>
  )
}

function SessionDrawers(): React.ReactElement {
  const { activityDrawer, proofsDrawer } = useNavMenus()
  const { activities, proofs } = useBorrowSession()

  return (
    <>
      <ActivityDrawer
        activities={activities}
        onOpenChange={activityDrawer.setOpen}
        open={activityDrawer.open}
      />
      <ProofsDrawer
        onOpenChange={proofsDrawer.setOpen}
        open={proofsDrawer.open}
        proofs={proofs}
      />
    </>
  )
}
