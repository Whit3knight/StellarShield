"use client"

import * as React from "react"

import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"

import { walletProviders, type WalletProvider } from "../_constants/account"
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
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)

      if (!nextOpen) {
        cancelPendingConnection()
      }
    },
    [cancelPendingConnection]
  )

  const handleConnect = React.useCallback(
    async (provider: WalletProvider) => {
      const connected = await connect(provider)

      if (connected) {
        setOpen(false)
      }
    },
    [connect]
  )

  if (!account) {
    return (
      <ConnectWalletDialog
        error={error}
        onConnect={handleConnect}
        onOpenChange={handleOpenChange}
        open={open}
        pendingProviderId={pendingProviderId}
        providers={walletProviders}
      />
    )
  }

  return (
    <>
      <NotificationMenu />
      <UserMenu account={account} onDisconnect={disconnect} />
    </>
  )
}
