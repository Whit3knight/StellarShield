"use client"

import * as React from "react"

import { appPreferenceKeys } from "@/app/_constants/preferences"
import type {
  ConnectedAccount,
  WalletProvider,
  WalletProviderId,
} from "@/app/_constants/account"

import {
  cancelWalletConnectConnection,
  connectWalletProvider,
  refreshConnectedAccountBalances,
  WalletConnectionCanceledError,
  WalletConnectionError,
} from "./connectors"

const walletConnectionChangeEvent = "stellar-shield:wallet-connection-change"
const WALLET_BALANCE_REFRESH_MS = 20_000
let cachedStoredAccount: ConnectedAccount | null = null
let cachedStoredAccountValue: string | null = null

type WalletConnectionState = {
  account: ConnectedAccount | null
  cancelPendingConnection: () => void
  connect: (provider: WalletProvider) => Promise<boolean>
  disconnect: () => void
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

    return () => {
      active = false
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", visibilityHandler)
    }
  }, [accountKey])

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

  return {
    account,
    cancelPendingConnection,
    connect,
    disconnect,
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

    cachedStoredAccount = JSON.parse(storedAccount) as ConnectedAccount
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
