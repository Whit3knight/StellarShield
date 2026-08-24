"use client"

import * as React from "react"

import type { WalletProviderId } from "@/app/_constants/account"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"

import { useShieldedPool } from "./use-shielded-pool"
import type { ScanIdentity } from "@/features/notes"

type ShieldedPoolContextValue = {
  account: string | null
  identity: ScanIdentity | null
  isScanning: boolean
  providerId: WalletProviderId | null
  refresh: () => void
}

const ShieldedPoolContext =
  React.createContext<ShieldedPoolContextValue | null>(null)

/**
 * Wraps `useShieldedPool` so the shielded identity + note-scan lifecycle
 * runs exactly once per session. Consumers on multiple drawers
 * (market panel, positions) subscribe via
 * `useShieldedPoolContext()` instead of each re-invoking the scanner.
 */
export function ShieldedPoolProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { account } = useWalletConnection()
  const address = account?.wallet.address ?? null
  const providerId = account?.wallet.providerId ?? null
  const { identity, isScanning, refresh } = useShieldedPool(
    address,
    providerId
  )

  const value = React.useMemo<ShieldedPoolContextValue>(
    () => ({ account: address, identity, isScanning, providerId, refresh }),
    [address, identity, isScanning, providerId, refresh]
  )

  return (
    <ShieldedPoolContext.Provider value={value}>
      {children}
    </ShieldedPoolContext.Provider>
  )
}

export function useShieldedPoolContext(): ShieldedPoolContextValue {
  const value = React.useContext(ShieldedPoolContext)
  if (!value) {
    throw new Error(
      "useShieldedPoolContext must be used within ShieldedPoolProvider"
    )
  }
  return value
}
