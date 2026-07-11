"use client"

import * as React from "react"

import type { ChainBorrowReceipt } from "@/features/protocol"

import { fetchChainBorrowPositions } from "./chain-positions"

/**
 * Load the list of confirmed borrow receipts for `account` off the
 * chain event log. Refetches whenever `enabled` toggles true (e.g.
 * drawer opens) or the account changes. Returns `{ isLoading, receipts }`
 * so consumers can show skeletons while the RPC round-trips.
 */
export function useChainPositions(
  account: string | null,
  enabled: boolean
): { isLoading: boolean; receipts: ChainBorrowReceipt[] } {
  const [receipts, setReceipts] = React.useState<ChainBorrowReceipt[]>([])
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    if (!account || !enabled) return

    const controller = new AbortController()
    void (async () => {
      setIsLoading(true)
      try {
        const list = await fetchChainBorrowPositions(account, controller.signal)
        if (controller.signal.aborted) return
        setReceipts(list)
      } catch {
        if (!controller.signal.aborted) setReceipts([])
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    })()

    return () => {
      controller.abort()
      setReceipts([])
      setIsLoading(false)
    }
  }, [account, enabled])

  return { isLoading, receipts }
}
