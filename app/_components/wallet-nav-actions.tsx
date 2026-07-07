"use client"

import * as React from "react"

import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"

import {
  getMockConnectedAccount,
  walletProviders,
  type ConnectedAccount,
  type WalletProvider,
} from "../_constants/account"
import { NotificationMenu } from "./notification-menu"
import { UserMenu } from "./user-menu"

export function WalletNavActions(): React.ReactElement {
  const [account, setAccount] = React.useState<ConnectedAccount | null>(null)
  const [open, setOpen] = React.useState(false)

  const handleConnect = React.useCallback((provider: WalletProvider) => {
    setAccount(getMockConnectedAccount(provider))
    setOpen(false)
  }, [])

  const handleDisconnect = React.useCallback(() => {
    setAccount(null)
  }, [])

  if (!account) {
    return (
      <ConnectWalletDialog
        onConnect={handleConnect}
        onOpenChange={setOpen}
        open={open}
        providers={walletProviders}
      />
    )
  }

  return (
    <>
      <NotificationMenu />
      <UserMenu account={account} onDisconnect={handleDisconnect} />
    </>
  )
}
