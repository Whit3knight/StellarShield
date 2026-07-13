"use client"

import * as React from "react"

import {
  onBorrowConfirmed,
  onDepositConfirmed,
  onRepayConfirmed,
} from "@/features/borrow-flow/borrow-events"
import {
  legacyIdentityFromAddress,
  scanShieldedNotes,
  useShieldedIdentity,
  type ScanIdentity,
} from "@/features/notes"

/**
 * Ties the shielded identity + note scanner to wallet connection +
 * borrow-events. Runs an initial scan on wallet connect and rescans
 * whenever a confirmation lands so the local note store stays fresh
 * without any explicit user action.
 *
 * Consumers only need `useNotes()` — this hook fires and forgets.
 */
export function useShieldedPool(account: string | null): {
  identity: ScanIdentity | null
  isScanning: boolean
  refresh: () => void
} {
  const identity = useShieldedIdentity(account)
  const [isScanning, setIsScanning] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)

  const refresh = React.useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    if (!identity || !account) return
    const controller = new AbortController()
    void (async () => {
      setIsScanning(true)
      try {
        // Legacy address-derived identity lets notes minted before the
        // R1 signature migration still decrypt and spend.
        const legacyIdentities = [await legacyIdentityFromAddress(account)]
        await scanShieldedNotes(identity, legacyIdentities, controller.signal)
      } catch {
        // swallow; retry on next confirm
      } finally {
        if (!controller.signal.aborted) setIsScanning(false)
      }
    })()

    const offBorrow = onBorrowConfirmed(() => setRefreshToken((t) => t + 1))
    const offRepay = onRepayConfirmed(() => setRefreshToken((t) => t + 1))
    const offDeposit = onDepositConfirmed(() =>
      setRefreshToken((t) => t + 1)
    )

    return () => {
      controller.abort()
      offBorrow()
      offRepay()
      offDeposit()
    }
  }, [identity, account, refreshToken])

  return { identity, isScanning, refresh }
}
