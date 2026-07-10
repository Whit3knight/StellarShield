import * as React from "react"

import type { BorrowFlowState } from "../types"

// Hold on the receipt after Confirmed so the user reads the success
// card + toast, then close the market drawer. Positions drawer is
// left alone — user opens it via the nav menu when they want to.
const CONFIRMED_CLOSE_DELAY_MS = 4_000

/**
 * On `Confirmed` transaction, close the current market drawer after a
 * brief hold. Shared between desktop + mobile market drawers.
 * Callbacks latched in refs so re-renders don't reset the timer.
 */
export function useConfirmedClose(
  transaction: BorrowFlowState["transaction"],
  onClose: () => void
): void {
  const onCloseRef = React.useRef(onClose)
  React.useEffect(() => {
    onCloseRef.current = onClose
  })

  const closedHashRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (transaction.status !== "Confirmed") return
    const hash = transaction.receipt.hash
    if (closedHashRef.current === hash) return
    closedHashRef.current = hash

    const timer = window.setTimeout(() => {
      onCloseRef.current()
    }, CONFIRMED_CLOSE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [transaction])
}
