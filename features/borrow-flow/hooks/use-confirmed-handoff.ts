import * as React from "react"

import { useNavMenus } from "@/app/_hooks/use-nav-menus"

import type { BorrowFlowState } from "../types"

// After a confirmed borrow, hold on the receipt for a moment so the
// user reads the success card + toast, then close the market drawer
// and pop open the Positions drawer.
const CONFIRMED_CLOSE_DELAY_MS = 2_500

/**
 * On Confirmed transaction, hand off to the Positions drawer + close
 * the current market drawer. Shared between desktop and mobile market
 * drawers so mobile users don't get stuck on the transaction step.
 * Callbacks latched in refs so re-renders don't cancel the timer.
 */
export function useConfirmedHandoff(
  transaction: BorrowFlowState["transaction"],
  onClose: () => void
): void {
  const { positionsDrawer } = useNavMenus()

  const onCloseRef = React.useRef(onClose)
  const positionsDrawerRef = React.useRef(positionsDrawer)
  React.useEffect(() => {
    onCloseRef.current = onClose
    positionsDrawerRef.current = positionsDrawer
  })

  const handedOffHashRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (transaction.status !== "Confirmed") return
    const hash = transaction.receipt.hash
    if (handedOffHashRef.current === hash) return
    handedOffHashRef.current = hash

    const timer = window.setTimeout(() => {
      positionsDrawerRef.current.setOpen(true)
      onCloseRef.current()
    }, CONFIRMED_CLOSE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [transaction])
}
