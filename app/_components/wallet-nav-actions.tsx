"use client"

import * as React from "react"

import { ActivityDrawer } from "@/components/organisms/activity-drawer"
import { ConnectWalletDialog } from "@/components/organisms/connect-wallet-dialog"
import { PositionsDrawer } from "@/components/organisms/positions-drawer"
import { ProofsDrawer } from "@/components/organisms/proofs-drawer"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
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
    disconnectAndForget,
    error,
    pendingProviderId,
  } = useWalletConnection()
  const { connectDialog } = useNavMenus()
  const [disconnectOpen, setDisconnectOpen] = React.useState(false)

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
          {/* ponytail: the menu's single Disconnect entry opens this
              sheet instead of a second menu item — `user-menu.tsx` takes
              one `onDisconnect` prop and nothing else. */}
          <UserMenu
            account={account}
            onDisconnect={() => setDisconnectOpen(true)}
          />
          <DisconnectDialog
            onDisconnect={disconnect}
            onForget={disconnectAndForget}
            onOpenChange={setDisconnectOpen}
            open={disconnectOpen}
          />
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

/**
 * Confirms the two ways out of a session. Plain disconnect only drops
 * the cached address; forgetting also erases the shielded identity seed
 * (the note spending key) and the local note cache.
 */
export function DisconnectDialog({
  onDisconnect,
  onForget,
  onOpenChange,
  open,
}: {
  onDisconnect: () => void
  onForget: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}): React.ReactElement {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect wallet</AlertDialogTitle>
          <AlertDialogDescription>
            Disconnecting leaves your shielded identity and note cache on this
            device. Forgetting erases both — you sign again to restore the
            identity, and notes are rebuilt only from chain events still within
            the retention window.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            onClick={onForget}
            render={<Button variant="destructive" />}
          >
            Disconnect and forget device
          </AlertDialogClose>
          <AlertDialogClose onClick={onDisconnect} render={<Button />}>
            Disconnect
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
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
