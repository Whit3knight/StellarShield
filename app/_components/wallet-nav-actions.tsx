"use client"

import * as React from "react"

import { ActivityDrawer } from "@/components/organisms/activity-drawer"
import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { PositionsDrawer } from "@/components/organisms/positions-drawer"
import { ProofsDrawer } from "@/components/organisms/proofs-drawer"
import { useBorrowSession } from "@/features/borrow-flow/session-store"
import { preloadProver } from "@/features/proofs"
import type { ChainBorrowReceipt } from "@/features/protocol"
import { useAdapters } from "@/features/shared/adapter-provider"
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
  const { activities, positions, proofs } = useBorrowSession()
  const chainPosition = useChainPosition(account, positionsDrawer.open)

  return (
    <>
      <ActivityDrawer
        activities={activities}
        onOpenChange={activityDrawer.setOpen}
        open={activityDrawer.open}
      />
      <PositionsDrawer
        chainPosition={chainPosition}
        onOpenChange={positionsDrawer.setOpen}
        open={positionsDrawer.open}
        positions={positions}
      />
      <ProofsDrawer
        onOpenChange={proofsDrawer.setOpen}
        open={proofsDrawer.open}
        proofs={proofs}
      />
    </>
  )
}

/**
 * Fetch the on-chain borrow position for `account` whenever the
 * positions drawer opens or the account changes. Cheap read via the
 * contract's `position(account)` view. Silent on network errors — the
 * drawer just shows the local list if the chain read fails.
 */
function useChainPosition(
  account: string | null,
  drawerOpen: boolean
): ChainBorrowReceipt | null {
  const { protocol } = useAdapters()
  const [chainPosition, setChainPosition] =
    React.useState<ChainBorrowReceipt | null>(null)

  React.useEffect(() => {
    if (!account || !drawerOpen || !protocol.readChainPosition) return

    const controller = new AbortController()
    void (async () => {
      const result = await protocol.readChainPosition!(
        { account },
        controller.signal
      )
      if (controller.signal.aborted) return
      setChainPosition(result.ok ? result.value : null)
    })()

    return () => {
      controller.abort()
      setChainPosition(null)
    }
  }, [account, drawerOpen, protocol])

  return chainPosition
}
