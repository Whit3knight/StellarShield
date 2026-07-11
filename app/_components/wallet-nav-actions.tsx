"use client"

import * as React from "react"

import { ActivityDrawer } from "@/components/organisms/activity-drawer"
import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { PositionsDrawer } from "@/components/organisms/positions-drawer"
import { ProofsDrawer } from "@/components/organisms/proofs-drawer"
import { useBorrowSession } from "@/features/borrow-flow/session-store"
import { useMergedActivities } from "@/features/borrow-flow/use-chain-activities"
import { useChainPositions } from "@/features/borrow-flow/use-chain-positions"
import { preloadProver } from "@/features/proofs"
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

  // Warm up the prover WASM the moment a wallet connects so the first
  // borrow flow skips module parse + init cost. Fire-and-forget.
  const isConnected = Boolean(account)
  React.useEffect(() => {
    if (!isConnected) return
    void preloadProver()
  }, [isConnected])

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
  const chainReadEnabled = positionsDrawer.open || activityDrawer.open
  const {
    isLoading: chainLoading,
    receipts: chainPositions,
    refresh: refreshChainPositions,
  } = useChainPositions(account, chainReadEnabled)
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
        account={account}
        chainLoading={chainLoading}
        chainPositions={chainPositions}
        onOpenChange={positionsDrawer.setOpen}
        onRepaid={refreshChainPositions}
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
