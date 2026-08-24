"use client"

import * as React from "react"

import { appPreferenceKeys } from "@/app/_constants/preferences"
import type {
  ConnectedAccount,
  WalletProvider,
  WalletProviderId,
} from "@/app/_constants/account"
import {
  onBorrowConfirmed,
  onRepayConfirmed,
} from "@/features/borrow-flow/borrow-events"
import { resetNotes } from "@/features/notes/note-store"
import { forgetShieldedIdentity } from "@/features/notes/use-shielded-identity"

import {
  cancelWalletConnectConnection,
  connectWalletProvider,
  refreshConnectedAccountBalances,
  WalletConnectionCanceledError,
  WalletConnectionError,
} from "./connectors"
import { getConfiguredNetworkPassphrase } from "./network"
import { isStellarAddress } from "./utils"

const walletConnectionChangeEvent = "stellar-shield:wallet-connection-change"
const WALLET_BALANCE_REFRESH_MS = 20_000
let cachedStoredAccount: ConnectedAccount | null = null
let cachedStoredAccountValue: string | null = null

type WalletConnectionState = {
  account: ConnectedAccount | null
  cancelPendingConnection: () => void
  connect: (provider: WalletProvider) => Promise<boolean>
  disconnect: () => void
  disconnectAndForget: () => void
  error: string | null
  pendingProviderId: WalletProviderId | null
}

export function useWalletConnection(): WalletConnectionState {
  const connectionAttemptRef = React.useRef(0)
  const account = React.useSyncExternalStore(
    subscribeToWalletConnection,
    readStoredAccount,
    () => null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pendingProviderId, setPendingProviderId] =
    React.useState<WalletProviderId | null>(null)
  const accountKey = account
    ? `${account.wallet.providerId}:${account.wallet.address}`
    : null

  React.useEffect(() => {
    if (!accountKey) {
      return
    }

    let active = true
    let inFlight = false

    const refreshOnce = async () => {
      if (inFlight) return
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return
      }

      const current = readStoredAccount()
      const currentKey = current
        ? `${current.wallet.providerId}:${current.wallet.address}`
        : null

      if (currentKey !== accountKey || !current) return

      inFlight = true

      try {
        const refreshed = await refreshConnectedAccountBalances(current)

        if (!active) return

        const latest = readStoredAccount()
        const latestKey = latest
          ? `${latest.wallet.providerId}:${latest.wallet.address}`
          : null

        if (latestKey !== accountKey || !latest) return

        if (JSON.stringify(latest) === JSON.stringify(refreshed)) return

        setStoredAccount(refreshed)
      } catch {
        // swallow refresh errors; next tick retries
      } finally {
        inFlight = false
      }
    }

    void refreshOnce()

    const intervalId = window.setInterval(
      refreshOnce,
      WALLET_BALANCE_REFRESH_MS
    )
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void refreshOnce()
      }
    }

    document.addEventListener("visibilitychange", visibilityHandler)

    const offBorrow = onBorrowConfirmed(() => void refreshOnce())
    const offRepay = onRepayConfirmed(() => void refreshOnce())

    return () => {
      active = false
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", visibilityHandler)
      offBorrow()
      offRepay()
    }
  }, [accountKey])

  // The app trusts a cached localStorage address forever (readStoredAccount
  // has no liveness check), so locking Freighter, switching its active
  // account, or switching its network is otherwise invisible — the UI
  // keeps showing a "connected" address the extension will no longer sign
  // for. Freighter's own `WatchWalletChanges` polls the SAME underlying
  // call as `getAddress()` (verified: both resolve via REQUEST_PUBLIC_KEY),
  // so a lock is exactly what we tested by hand — address goes to "".
  //
  // Only `disconnect()`, never `disconnectAndForget()`: a lock is
  // transient. The identity seed and note cache must survive it so
  // reconnecting after unlock is instant, with no re-signing.
  React.useEffect(() => {
    if (!account || account.wallet.providerId !== "freighter") {
      return
    }

    let cancelled = false
    const address = account.wallet.address
    const watcherRef: { current: { stop: () => void } | null } = {
      current: null,
    }

    void (async () => {
      const { WatchWalletChanges } = await import("@stellar/freighter-api")
      if (cancelled) return

      const watcher = new WatchWalletChanges()
      watcherRef.current = watcher
      watcher.watch(async ({ address: liveAddress, networkPassphrase }) => {
        if (cancelled) return
        if (liveAddress === address && networkPassphrase === getConfiguredNetworkPassphrase()) {
          return
        }

        const reason = !liveAddress
          ? "Freighter locked — reconnect to continue."
          : liveAddress !== address
            ? "Freighter switched accounts — reconnect to use the new one."
            : "Freighter switched network — reconnect on Testnet."

        setError(null)
        setStoredAccount(null)
        const { toastManager } = await import("@/components/ui/toast")
        toastManager.add({ title: "Wallet disconnected", description: reason, type: "info" })
      })
    })()

    return () => {
      cancelled = true
      watcherRef.current?.stop()
    }
  }, [account])

  const connect = React.useCallback(async (provider: WalletProvider) => {
    const attemptId = connectionAttemptRef.current + 1

    connectionAttemptRef.current = attemptId
    setError(null)
    setPendingProviderId(provider.id)

    try {
      const connectedAccount = await connectWalletProvider(provider)

      if (connectionAttemptRef.current !== attemptId) {
        return false
      }

      setStoredAccount(connectedAccount)

      return true
    } catch (connectionError) {
      if (connectionAttemptRef.current !== attemptId) {
        return false
      }

      if (connectionError instanceof WalletConnectionCanceledError) {
        return false
      }

      setError(getConnectionErrorMessage(connectionError))
      return false
    } finally {
      if (connectionAttemptRef.current === attemptId) {
        setPendingProviderId(null)
      }
    }
  }, [])

  const cancelPendingConnection = React.useCallback(() => {
    connectionAttemptRef.current += 1
    setError(null)
    setPendingProviderId(null)
    cancelWalletConnectConnection()
  }, [])

  const disconnect = React.useCallback(() => {
    setError(null)
    setStoredAccount(null)
  }, [])

  // Plain `disconnect` only forgets the address. The shielded identity
  // seed IS the note spending key, and `withdraw_shielded` does not bind
  // the recipient into the proof, so anyone who reads that seed off a
  // shared machine can drain the notes without the wallet key. This is
  // the "I am done on this device" exit: seed and note cache go too.
  const disconnectAndForget = React.useCallback(() => {
    const address = readStoredAccount()?.wallet.address
    if (address) forgetShieldedIdentity(address)
    resetNotes(address)
    disconnect()
  }, [disconnect])

  return {
    account,
    cancelPendingConnection,
    connect,
    disconnect,
    disconnectAndForget,
    error,
    pendingProviderId,
  }
}

function subscribeToWalletConnection(callback: () => void): () => void {
  window.addEventListener("storage", callback)
  window.addEventListener(walletConnectionChangeEvent, callback)

  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(walletConnectionChangeEvent, callback)
  }
}

function readStoredAccount(): ConnectedAccount | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const storedAccount = window.localStorage.getItem(
      appPreferenceKeys.connectedWallet
    )

    if (storedAccount === cachedStoredAccountValue) {
      return cachedStoredAccount
    }

    cachedStoredAccountValue = storedAccount

    if (!storedAccount) {
      cachedStoredAccount = null
      return null
    }

    const parsed = JSON.parse(storedAccount) as ConnectedAccount
    // Guard against a corrupted / truncated address landing in
    // storage from a previous buggy session. Every downstream Horizon
    // fetch would 400-loop on a bad strkey; better to force a fresh
    // reconnect than pin the user to broken state.
    if (!isStellarAddress(parsed?.wallet?.address)) {
      cachedStoredAccount = null
      cachedStoredAccountValue = null
      window.localStorage.removeItem(appPreferenceKeys.connectedWallet)
      return null
    }
    cachedStoredAccount = parsed
    return cachedStoredAccount
  } catch {
    cachedStoredAccount = null
    cachedStoredAccountValue = null
    window.localStorage.removeItem(appPreferenceKeys.connectedWallet)
    return null
  }
}

function setStoredAccount(account: ConnectedAccount | null): void {
  if (account) {
    const storedAccount = JSON.stringify(account)

    cachedStoredAccount = account
    cachedStoredAccountValue = storedAccount
    window.localStorage.setItem(appPreferenceKeys.connectedWallet, storedAccount)
  } else {
    cachedStoredAccount = null
    cachedStoredAccountValue = null
    window.localStorage.removeItem(appPreferenceKeys.connectedWallet)
  }

  window.dispatchEvent(new Event(walletConnectionChangeEvent))
}

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof WalletConnectionError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return "Unable to connect wallet. Try again."
}
