"use client"

import * as React from "react"

import { useWalletConnection } from "@/features/wallet/use-wallet-connection"

import { useShieldedPool } from "./use-shielded-pool"
import type { ScanIdentity } from "@/features/notes"

type ShieldedPoolContextValue = {
  account: string | null
  identity: ScanIdentity | null
  isScanning: boolean
  refresh: () => void
}

const ShieldedPoolContext =
  React.createContext<ShieldedPoolContextValue | null>(null)

/**
 * Wraps `useShieldedPool` so the shielded identity + note-scan lifecycle
 * runs exactly once per session. Consumers on multiple drawers
 * (market panel, positions, backup) subscribe via
 * `useShieldedPoolContext()` instead of each re-invoking the scanner.
 */
export function ShieldedPoolProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { account } = useWalletConnection()
  const address = account?.wallet.address ?? null
  const { identity, isScanning, refresh } = useShieldedPool(address)

  const value = React.useMemo<ShieldedPoolContextValue>(
    () => ({ account: address, identity, isScanning, refresh }),
    [address, identity, isScanning, refresh]
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
