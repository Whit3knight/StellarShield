import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"
import { useAdapters } from "@/features/shared/adapter-provider"

import { INITIAL_FLOW_STATE } from "../constants"
import {
  appendBorrowActivity,
  createConfirmedPositionActivity,
  createIntentPreparedActivity,
  createProofGeneratedActivity,
  createTransactionSubmittedActivity,
  createWalletConnectedActivity,
} from "../activities"
import { createUserPosition } from "../positions"
import { borrowSession } from "../session-store"
import type {
  BorrowActivity,
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
  Transaction,
  UserPosition,
  Verification,
} from "../types"
import {
  canSubmitTransaction,
  createBorrowIntentFromFlow,
  generateProof,
  simulateBorrowIntentFromFlow,
} from "../flow-actions"
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

type UseBorrowFlowParams = {
  account: ConnectedAccount | null
  market: MarketCardData
}

export function useBorrowFlow({
  account,
  market,
}: UseBorrowFlowParams): BorrowFlowControls {
  const [flow, setFlow] = React.useState<BorrowFlowState>(INITIAL_FLOW_STATE)
  const [activity, setActivity] = React.useState<BorrowActivity[]>([])
  const [position, setPosition] = React.useState<UserPosition | null>(null)
  const { protocol: protocolAdapter, prover } = useAdapters()
  const verifyAbortRef = React.useRef<AbortController | null>(null)
  const submitAbortRef = React.useRef<AbortController | null>(null)
  const connectedWalletRef = React.useRef<string | null>(null)
  const confirmedPayloadRef = React.useRef<string | null>(null)
  const autoVerifyKeyRef = React.useRef<string | null>(null)
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

  React.useEffect(() => {
    return () => {
      verifyAbortRef.current?.abort()
      submitAbortRef.current?.abort()
    }
  }, [])

  React.useEffect(() => {
    if (!account || connectedWalletRef.current === account.wallet.address) {
      return
    }

    connectedWalletRef.current = account.wallet.address
    const walletConnectedActivity = createWalletConnectedActivity({ account })

    setActivity((currentActivity) =>
      appendBorrowActivity(currentActivity, walletConnectedActivity)
    )
    borrowSession.appendActivity(walletConnectedActivity)
  }, [account])

  React.useEffect(() => {
    if (flow.transaction.status !== "Confirmed") return

    const payloadId = flow.transaction.payload.id

    if (confirmedPayloadRef.current === payloadId) return

    const nextPosition = createUserPosition({
      flow,
      market,
      metrics,
      receipt: flow.transaction.receipt,
    })

    confirmedPayloadRef.current = payloadId
    // ponytail: local position mirror kept for transaction-step reader; drop
    // when consumers switch to useBorrowSession().positions filtered by market.
    setPosition(nextPosition)
    borrowSession.appendPosition(nextPosition)
    const confirmedActivity = createConfirmedPositionActivity({
      position: nextPosition,
    })

    setActivity((currentActivity) =>
      appendBorrowActivity(currentActivity, confirmedActivity)
    )
    borrowSession.appendActivity(confirmedActivity)
  }, [flow, market, metrics])

  const setFieldValue = React.useCallback(
    (field: BorrowField, value: string) => {
      verifyAbortRef.current?.abort()
      submitAbortRef.current?.abort()
      autoVerifyKeyRef.current = null
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
    verifyAbortRef.current?.abort()
    const controller = new AbortController()
    verifyAbortRef.current = controller
    const { signal } = controller

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: { status: "Draft" },
      verification: {
        status: metrics.isLoanValid ? "Preparing" : "Generating proof",
      },
    }))

    const proofResult = await generateProof({
      account,
      market,
      metrics,
      prover,
      signal,
    })

    if (signal.aborted) return
    if (!proofResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verification: { status: "Not started" },
      }))
      return
    }

    const proof = proofResult.value

    if (!metrics.isLoanValid) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verification: { status: "Failed", proof },
      }))
      const proofActivity = createProofGeneratedActivity({ proof })

      setActivity((currentActivity) =>
        appendBorrowActivity(currentActivity, proofActivity)
      )
      borrowSession.appendActivity(proofActivity)
      borrowSession.appendProof(proof)
      return
    }

    const intentResult = await createBorrowIntentFromFlow({
      account,
      adapter: protocolAdapter,
      metrics,
      proof,
      signal,
    })

    if (signal.aborted) return
    const intent = intentResult.ok ? intentResult.value : null
    const simulationResult = intent
      ? await simulateBorrowIntentFromFlow({
          adapter: protocolAdapter,
          intent,
          metrics,
          signal,
        })
      : null

    if (signal.aborted) return

    const payload = simulationResult?.ok ? simulationResult.value : null
    const nextVerification: Verification =
      proof.status === "Verified"
        ? { status: "Verified", proof }
        : { status: "Failed", proof }
    const nextTransaction: Transaction =
      intent && payload
        ? { status: "Ready", intent, payload }
        : { status: "Draft" }

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: nextTransaction,
      verification: nextVerification,
    }))
    const proofActivity = createProofGeneratedActivity({ proof })
    const intentActivity = intent
      ? createIntentPreparedActivity({ intent })
      : null

    setActivity((currentActivity) => {
      let next = appendBorrowActivity(currentActivity, proofActivity)

      if (intentActivity) {
        next = appendBorrowActivity(next, intentActivity)
      }

      return next
    })
    borrowSession.appendActivity(proofActivity)
    if (intentActivity) borrowSession.appendActivity(intentActivity)
    borrowSession.appendProof(proof)
  }, [account, market, metrics, protocolAdapter, prover])

  // Precompute the eligibility proof + intent + simulation in the
  // background as soon as the amount fields settle. When the user
  // clicks Verify, the flow already sits at `Ready` and only signing +
  // submit remain. Debounce 300ms to avoid firing on every keystroke.
  // Attempts are keyed on (collateralAmount, loanAmount) so a failed
  // attempt does not loop — the user must edit to retry.
  React.useEffect(() => {
    if (!metrics.hasWallet || !metrics.isLoanValid) return
    if (flow.verification.status !== "Not started") return
    if (flow.transaction.status !== "Draft") return

    const key = `${deferredCollateralAmount}|${deferredLoanAmount}`
    if (autoVerifyKeyRef.current === key) return

    const timer = window.setTimeout(() => {
      autoVerifyKeyRef.current = key
      void verifyEligibility()
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    deferredCollateralAmount,
    deferredLoanAmount,
    flow.transaction.status,
    flow.verification.status,
    metrics.hasWallet,
    metrics.isLoanValid,
    verifyEligibility,
  ])

  const submitTransaction = React.useCallback(async () => {
    if (
      !account ||
      flow.transaction.status !== "Ready" ||
      !canSubmitTransaction({
        metrics,
        status: flow.verification.status,
        transaction: flow.transaction,
      })
    ) {
      return
    }

    const { intent, payload } = flow.transaction

    submitAbortRef.current?.abort()
    const controller = new AbortController()
    submitAbortRef.current = controller
    const { signal } = controller

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: { status: "Signing", intent, payload },
    }))

    const signResult = await protocolAdapter.signTransaction(
      { account: account.wallet.address, payload },
      signal
    )

    if (signal.aborted) return
    if (!signResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transaction: {
          status: "Failed",
          intent,
          payload,
          error: signResult.error,
        },
      }))
      return
    }

    const submitResult = await protocolAdapter.submitTransaction(
      {
        payload: signResult.value.payload,
        signedXdr: signResult.value.signedXdr,
      },
      signal
    )

    if (signal.aborted) return
    if (!submitResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transaction: {
          status: "Failed",
          intent,
          payload: signResult.value.payload,
          error: submitResult.error,
        },
      }))
      return
    }

    const submittedPayload = submitResult.value

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: { status: "Submitted", intent, payload: submittedPayload },
    }))
    const submittedActivity = createTransactionSubmittedActivity({
      status: submittedPayload.status,
    })

    setActivity((currentActivity) =>
      appendBorrowActivity(currentActivity, submittedActivity)
    )
    borrowSession.appendActivity(submittedActivity)

    const waitResult = await protocolAdapter.waitForConfirmation(
      { payload: submittedPayload },
      signal
    )

    if (signal.aborted) return
    if (!waitResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transaction: {
          status: "Failed",
          intent,
          payload: submittedPayload,
          error: waitResult.error,
        },
      }))
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      transaction: {
        status: "Confirmed",
        intent,
        payload: submittedPayload,
        receipt: waitResult.value,
      },
    }))
  }, [account, flow, metrics, protocolAdapter])

  return {
    activity,
    flow,
    metrics,
    position,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  }
}
