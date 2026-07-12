"use client"

import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"
import {
  COLLATERAL_NOTES_PER_BORROW,
  useNotes,
  type ShieldedAsset,
} from "@/features/notes"
import type {
  BorrowIntent,
  ProtocolTransactionPayload,
  ProtocolTransactionReceipt,
} from "@/features/protocol"
import { getRiskParams } from "@/features/protocol/risk-params"
import { useBorrow } from "@/features/shielded-pool/use-borrow"
import { useDeposit } from "@/features/shielded-pool/use-deposit"
import { useShieldedPoolContext } from "@/features/shielded-pool/shielded-pool-provider"

import { INITIAL_FLOW_STATE } from "../constants"
import type { BorrowProof, UserPosition } from "../types"
import type {
  BorrowActivity,
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
  Transaction,
} from "../types"
import { getBorrowFlowMetrics } from "../quote"

type BorrowFlowControls = {
  activity: BorrowActivity[]
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  position: UserPosition | null
  setFieldValue: (field: BorrowField, value: string) => void
  submitTransaction: () => Promise<void>
  verifyEligibility: () => Promise<void>
}

type UseShieldedBorrowFlowParams = {
  account: ConnectedAccount | null
  market: MarketCardData
}

/**
 * Shielded-pool replacement for the legacy `useBorrowFlow`. Preserves
 * the public interface the market drawer's step components read from
 * (flow.verification, flow.transaction, metrics, position) so the
 * visual keeps its 4-card stack. Internally:
 *
 *   verifyEligibility → deposit any missing shielded collateral notes
 *   submitTransaction → runs the shielded borrow (prove + sign + send +
 *                       wait) via the shared `useBorrow` orchestrator
 *
 * The proof / intent / payload / receipt shapes fed into flow are
 * lightweight synthetic values — enough for the legacy step components
 * to render timelines and receipts, no real receipt-registry data.
 */
export function useShieldedBorrowFlow({
  account,
  market,
}: UseShieldedBorrowFlowParams): BorrowFlowControls {
  const [flow, setFlow] = React.useState<BorrowFlowState>(INITIAL_FLOW_STATE)
  const [position, setPosition] = React.useState<UserPosition | null>(null)
  const walletAddress = account?.wallet.address ?? null
  const { identity } = useShieldedPoolContext()
  const notes = useNotes()

  const collateralAsset = market.collateral as ShieldedAsset
  const borrowAsset = market.symbol as ShieldedAsset

  const { deposit } = useDeposit(walletAddress, identity)
  const { borrow } = useBorrow(walletAddress, identity)

  const deferredCollateralAmount = React.useDeferredValue(flow.collateralAmount)
  const deferredLoanAmount = React.useDeferredValue(flow.loanAmount)
  const metrics = React.useMemo(
    () =>
      getBorrowFlowMetrics(
        {
          collateralAmount: deferredCollateralAmount,
          loanAmount: deferredLoanAmount,
        },
        market,
        account
      ),
    [account, deferredCollateralAmount, deferredLoanAmount, market]
  )

  const setFieldValue = React.useCallback(
    (field: BorrowField, value: string) => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        [field]: value,
        transaction: { status: "Draft" },
        verification: { status: "Not started" },
      }))
    },
    []
  )

  const verifyEligibility = React.useCallback(async () => {
    if (!walletAddress || !identity) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verification: { status: "Failed", proof: null },
      }))
      return
    }

    // Guard against re-entry: a residual click or a re-render that
    // still holds a fresh `verifyEligibility` reference can otherwise
    // start a second deposit loop while the first is mid-flight.
    if (
      flow.verification.status === "Preparing" ||
      flow.verification.status === "Generating proof" ||
      flow.verification.status === "Verified"
    ) {
      return
    }
    if (
      flow.transaction.status === "Signing" ||
      flow.transaction.status === "Submitted" ||
      flow.transaction.status === "Confirmed"
    ) {
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      verification: { status: "Preparing" },
      transaction: { status: "Draft" },
    }))

    // Round the collateral input up to a note-count multiple. If the
    // input is empty or below the circuit's fixed 4-note floor, fall
    // back to the minimum.
    const collateralWhole = Number(deferredCollateralAmount) || 0
    // The prover requires the 4-note minimum regardless of the user's
    // input; the deposit loop tops up whatever's missing.
    const ownedNotes = notes.filter(
      (n) => n.tree === "deposit" && n.asset === collateralAsset
    ).length
    const targetNotes = Math.max(
      COLLATERAL_NOTES_PER_BORROW,
      Math.ceil(collateralWhole / notesForOneUnit(collateralAsset))
    )
    const missing = Math.max(0, targetNotes - ownedNotes)

    setFlow((currentFlow) => ({
      ...currentFlow,
      verification: { status: "Generating proof" },
    }))

    for (let i = 0; i < missing; i++) {
      const result = await deposit(collateralAsset)
      if (!result) {
        setFlow((currentFlow) => ({
          ...currentFlow,
          verification: { status: "Failed", proof: null },
        }))
        return
      }
    }

    const risk = await getRiskParams().catch(() => null)
    const now = Date.now()
    const proof: BorrowProof = {
      claim: `Shielded collateral of ${targetNotes} × ${collateralAsset} ready`,
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      generatedAt: new Date(now).toISOString(),
      id: `shielded-${now}`,
      publicInputs: {
        healthFactorMin: risk ? (risk.hfMinBps / 100).toFixed(1) : "125",
        market: `${borrowAsset}/${collateralAsset}`,
        maxLtv: risk ? (risk.maxLtvBps / 100).toFixed(1) : "62.5",
      },
      status: "Verified",
    }
    const intent: BorrowIntent = {
      account: walletAddress,
      borrow: {
        amount: Number(deferredLoanAmount) || 0,
        symbol: borrowAsset,
        valueUsd: metrics.loanValue,
      },
      collateral: {
        amount: collateralWhole,
        symbol: collateralAsset,
        valueUsd: metrics.collateralValue,
      },
      expiresAt: proof.expiresAt,
      healthFactor: metrics.healthFactor,
      id: `shielded-intent-${now}`,
      market: `${borrowAsset}/${collateralAsset}`,
      maxLtv: risk ? risk.maxLtvBps / 10_000 : 0.625,
      proofId: proof.id,
    }
    const payload: ProtocolTransactionPayload = {
      expiresAt: proof.expiresAt,
      fee: metrics.quote.estimatedFee,
      id: `shielded-payload-${now}`,
      intentId: intent.id,
      memo: "shielded borrow",
      network: "stellar-testnet",
      operation: "borrow",
      status: "Ready",
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      verification: { status: "Verified", proof },
      transaction: { status: "Ready", intent, payload },
    }))
  }, [
    borrowAsset,
    collateralAsset,
    deferredCollateralAmount,
    deferredLoanAmount,
    deposit,
    flow.transaction.status,
    flow.verification.status,
    identity,
    metrics.collateralValue,
    metrics.healthFactor,
    metrics.loanValue,
    metrics.quote.estimatedFee,
    notes,
    walletAddress,
  ])

  const submitTransaction = React.useCallback(async () => {
    if (!walletAddress || !identity) return
    if (flow.verification.status !== "Verified") return

    // Re-entry guard: once a borrow tx is in-flight or already
    // confirmed, ignore repeat clicks. Only Ready (fresh) or Failed
    // (retry) are legitimate entry points; Signing / Submitted /
    // Confirmed all mean we're either mid-work or already done.
    if (
      flow.transaction.status === "Signing" ||
      flow.transaction.status === "Submitted" ||
      flow.transaction.status === "Confirmed"
    ) {
      return
    }

    let intent: BorrowIntent
    let payload: ProtocolTransactionPayload
    if (
      flow.transaction.status === "Ready" ||
      (flow.transaction.status === "Failed" &&
        flow.transaction.intent &&
        flow.transaction.payload)
    ) {
      const t = flow.transaction as Extract<
        Transaction,
        { intent?: BorrowIntent; payload?: ProtocolTransactionPayload }
      >
      intent = t.intent as BorrowIntent
      payload = t.payload as ProtocolTransactionPayload
    } else {
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: { status: "Signing", intent, payload },
    }))

    const result = await borrow({ borrowAsset, collateralAsset })
    if (!result) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transaction: {
          status: "Failed",
          intent,
          payload,
        },
      }))
      return
    }

    const submittedPayload: ProtocolTransactionPayload = {
      ...payload,
      hash: result.txHash,
      status: "Submitted",
    }
    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: {
        status: "Submitted",
        intent,
        payload: submittedPayload,
      },
    }))

    const receipt: ProtocolTransactionReceipt = {
      confirmedAt: new Date().toISOString(),
      hash: result.txHash,
      network: "stellar-testnet",
    }
    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: {
        status: "Confirmed",
        intent,
        payload: submittedPayload,
        receipt,
      },
    }))

    // Emit a minimal UserPosition so the transaction step's summary
    // renders "Position open" with the tx hash.
    setPosition({
      borrowed: [
        {
          amount: Number(deferredLoanAmount) || 0,
          symbol: borrowAsset,
          valueUsd: metrics.loanValue,
        },
      ],
      borrowingPowerUsed: metrics.utilization,
      healthFactor: metrics.healthFactor,
      id: intent.id,
      market: intent.market,
      nextPaymentDue: "-",
      openedAt: new Date().toISOString(),
      receiptHash: result.txHash,
      status: "Open",
      supplied: [
        {
          amount: Number(deferredCollateralAmount) || 0,
          symbol: collateralAsset,
          valueUsd: metrics.collateralValue,
        },
      ],
    })
  }, [
    borrow,
    borrowAsset,
    collateralAsset,
    deferredCollateralAmount,
    deferredLoanAmount,
    flow.transaction,
    flow.verification.status,
    identity,
    metrics.collateralValue,
    metrics.healthFactor,
    metrics.loanValue,
    metrics.utilization,
    walletAddress,
  ])

  return {
    activity: [],
    flow,
    metrics,
    position,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  }
}

/**
 * Convenience: how many whole units one deposit note carries. This
 * belongs next to DENOMINATION but is inlined here to avoid another
 * import churn; refactor if it grows callers.
 */
function notesForOneUnit(asset: ShieldedAsset): number {
  // Matches DENOMINATION values in features/notes/note.ts.
  if (asset === "XLM") return 100
  return 10 // USDC + EURC
}
