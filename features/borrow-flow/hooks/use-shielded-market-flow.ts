"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  COLLATERAL_NOTES_PER_BORROW,
  DENOMINATION,
  useNotes,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import type { MarketCardData } from "@/features/markets"
import { useDeposit } from "@/features/shielded-pool/use-deposit"
import { useBorrow } from "@/features/shielded-pool/use-borrow"
import { useShieldedPoolContext } from "@/features/shielded-pool/shielded-pool-provider"

export type ShieldedMarketPhase =
  | "input"
  | "depositing"
  | "ready-to-borrow"
  | "borrowing"
  | "confirmed"
  | "failed"

type UseShieldedMarketFlowResult = {
  collateralAmount: string
  setCollateralAmount: (value: string) => void
  denomination: bigint
  ownedNoteCount: number
  targetNoteCount: number
  additionalNotesNeeded: number
  depositProgress: { done: number; total: number }
  phase: ShieldedMarketPhase
  errorMessage: string | null
  txHash: string | null
  ready: boolean
  runDeposits: () => Promise<void>
  runBorrow: () => Promise<void>
  reset: () => void
}

/**
 * Orchestrates the market-panel-side shielded borrow. Wraps the
 * existing shielded deposit + borrow hooks under a linear phase
 * machine so the drawer steps can react to progress without knowing
 * about the underlying zk pipeline.
 *
 * Contract-side circuit still enforces the fixed denomination; this
 * hook rounds the user's whole-unit collateral input UP to the
 * nearest note count so the shielded borrow's 4-note constraint holds.
 */
export function useShieldedMarketFlow({
  market,
}: {
  market: MarketCardData
}): UseShieldedMarketFlowResult {
  const notes = useNotes()
  const { account, identity } = useShieldedPoolContext()
  const collateralAsset = market.collateral as ShieldedAsset
  const denomination = DENOMINATION[collateralAsset]
  const denominationWhole = Number(denomination)

  const [collateralAmount, setCollateralAmount] = React.useState("")
  const [phase, setPhase] = React.useState<ShieldedMarketPhase>("input")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [txHash, setTxHash] = React.useState<string | null>(null)
  const [depositProgress, setDepositProgress] = React.useState<{
    done: number
    total: number
  }>({ done: 0, total: 0 })

  const { deposit } = useDeposit(account, identity)
  const { borrow } = useBorrow(account, identity)

  const ownedNoteCount = React.useMemo(
    () =>
      notes.filter(
        (note) => note.tree === "deposit" && note.asset === collateralAsset
      ).length,
    [collateralAsset, notes]
  )

  const parsedAmount = Number(collateralAmount)
  const targetNoteCount = React.useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return COLLATERAL_NOTES_PER_BORROW
    }
    const rawNotes = Math.ceil(parsedAmount / denominationWhole)
    return Math.max(COLLATERAL_NOTES_PER_BORROW, rawNotes)
  }, [denominationWhole, parsedAmount])

  const additionalNotesNeeded = Math.max(
    0,
    targetNoteCount - ownedNoteCount
  )
  const ready = ownedNoteCount >= COLLATERAL_NOTES_PER_BORROW

  const reset = React.useCallback(() => {
    setPhase("input")
    setErrorMessage(null)
    setTxHash(null)
    setDepositProgress({ done: 0, total: 0 })
  }, [])

  const runDeposits = React.useCallback(async () => {
    if (!account || !identity) {
      setPhase("failed")
      setErrorMessage("Connect a wallet first.")
      return
    }
    const need = additionalNotesNeeded
    if (need === 0) {
      setPhase(ready ? "ready-to-borrow" : "input")
      return
    }
    setPhase("depositing")
    setErrorMessage(null)
    setDepositProgress({ done: 0, total: need })

    for (let i = 0; i < need; i++) {
      const result = await deposit(collateralAsset)
      if (!result) {
        // Sub-hook already surfaced the toast + reason via useDeposit
        // status; bail out and let the user retry the remaining notes.
        setPhase("failed")
        setErrorMessage("Deposit interrupted before all notes were shielded.")
        return
      }
      setDepositProgress({ done: i + 1, total: need })
    }

    setPhase("ready-to-borrow")
    toastManager.add({
      title: "Collateral shielded",
      description: `${need} note${need === 1 ? "" : "s"} added to your inventory.`,
      type: "success",
      timeout: 4_000,
    })
  }, [
    account,
    additionalNotesNeeded,
    collateralAsset,
    deposit,
    identity,
    ready,
  ])

  const runBorrow = React.useCallback(async () => {
    if (!account || !identity) {
      setPhase("failed")
      setErrorMessage("Connect a wallet first.")
      return
    }
    if (!ready) {
      setPhase("failed")
      setErrorMessage(
        `Need ${COLLATERAL_NOTES_PER_BORROW} shielded ${collateralAsset} notes to borrow.`
      )
      return
    }
    setPhase("borrowing")
    setErrorMessage(null)

    const result = await borrow({
      borrowAsset: market.symbol as ShieldedAsset,
      collateralAsset,
    })
    if (!result) {
      setPhase("failed")
      setErrorMessage("Borrow did not confirm; see toast for details.")
      return
    }

    setTxHash(result.txHash)
    setPhase("confirmed")
  }, [
    account,
    borrow,
    collateralAsset,
    identity,
    market.symbol,
    ready,
  ])

  // Derive the outward-facing phase so "input" auto-promotes to
  // "ready-to-borrow" the moment the user already owns enough notes.
  // Doing this in a computed value (rather than a setState-in-effect)
  // keeps the lint rule happy and dodges the double-render.
  const effectivePhase: ShieldedMarketPhase =
    phase === "input" && ready ? "ready-to-borrow" : phase

  return {
    collateralAmount,
    setCollateralAmount,
    denomination,
    ownedNoteCount,
    targetNoteCount,
    additionalNotesNeeded,
    depositProgress,
    phase: effectivePhase,
    errorMessage,
    txHash,
    ready,
    runDeposits,
    runBorrow,
    reset,
  }
}

/**
 * Cheap heuristic for the expected loan size the borrower will receive
 * after the shielded borrow lands. Fed to the drawer preview so the
 * user sees a rough number before the proof runs; the actual amount
 * comes from the circuit's LTV × Σcollat × oracle_price computation.
 */
export function estimateLoanNotional(
  notes: ShieldedNote[],
  collateralAsset: ShieldedAsset,
  targetNoteCount: number,
  ltvBps: number
): number {
  const useCount = Math.min(
    notes.filter((n) => n.tree === "deposit" && n.asset === collateralAsset)
      .length,
    targetNoteCount
  )
  if (useCount < COLLATERAL_NOTES_PER_BORROW) return 0
  const totalCollateralWhole = useCount * Number(DENOMINATION[collateralAsset])
  return (totalCollateralWhole * ltvBps) / 10_000
}
