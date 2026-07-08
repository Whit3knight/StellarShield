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
  const refreshedAccountKeyRef = React.useRef<string | null>(null)
  const account = React.useSyncExternalStore(
    subscribeToWalletConnection,
    readStoredAccount,
    () => null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pendingProviderId, setPendingProviderId] =
    React.useState<WalletProviderId | null>(null)

  React.useEffect(() => {
    if (!account) {
      refreshedAccountKeyRef.current = null
      return
    }

    const accountKey = `${account.wallet.providerId}:${account.wallet.address}`

    if (refreshedAccountKeyRef.current === accountKey) {
      return
    }

    refreshedAccountKeyRef.current = accountKey
    let active = true

    refreshConnectedAccountBalances(account)
      .then((refreshedAccount) => {
        if (!active) {
          return
        }

        const currentAccount = readStoredAccount()

        if (
          !currentAccount ||
          currentAccount.wallet.address !== account.wallet.address ||
          currentAccount.wallet.providerId !== account.wallet.providerId
        ) {
          return
        }

        if (JSON.stringify(currentAccount) === JSON.stringify(refreshedAccount)) {
          return
        }

        setStoredAccount(refreshedAccount)
      })
      .catch(() => undefined)

    return () => {
      active = false
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
