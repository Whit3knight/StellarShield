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
import type {
  BorrowActivity,
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
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
  refreshTransaction: () => void
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
    setActivity((currentActivity) =>
      appendBorrowActivity(
        currentActivity,
        createWalletConnectedActivity({ account })
      )
    )
  }, [account])

  React.useEffect(() => {
    const payloadId = flow.transactionPayload?.id ?? null

    if (
      flow.transactionStatus !== "Confirmed" ||
      !flow.transactionReceipt ||
      !payloadId ||
      confirmedPayloadRef.current === payloadId
    ) {
      return
    }

    const nextPosition = createUserPosition({
      flow,
      market,
      metrics,
      receipt: flow.transactionReceipt,
    })

    confirmedPayloadRef.current = payloadId
    setPosition(nextPosition)
    setActivity((currentActivity) =>
      appendBorrowActivity(
        currentActivity,
        createConfirmedPositionActivity({ position: nextPosition })
      )
    )
  }, [flow, market, metrics])

  const setFieldValue = React.useCallback(
    (field: BorrowField, value: string) => {
      verifyAbortRef.current?.abort()
      submitAbortRef.current?.abort()
      setFlow((currentFlow) => ({
        ...currentFlow,
        [field]: value,
        borrowIntent: null,
        simulationStatus: "Idle",
        transactionPayload: null,
        transactionReceipt: null,
        transactionStatus: "Draft",
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
      borrowIntent: null,
      simulationStatus: "Idle",
      transactionPayload: null,
      transactionReceipt: null,
      transactionStatus: "Draft",
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
      setActivity((currentActivity) =>
        appendBorrowActivity(
          currentActivity,
          createProofGeneratedActivity({ proof })
        )
      )
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

    setFlow((currentFlow) => ({
      ...currentFlow,
      borrowIntent: intent,
      simulationStatus: payload ? "Ready" : "Idle",
      transactionPayload: payload,
      transactionReceipt: null,
      transactionStatus: payload ? "Ready" : "Draft",
      verification: nextVerification,
    }))
    setActivity((currentActivity) => {
      let next = appendBorrowActivity(
        currentActivity,
        createProofGeneratedActivity({ proof })
      )

      if (intent) {
        next = appendBorrowActivity(
          next,
          createIntentPreparedActivity({ intent })
        )
      }

      return next
    })
  }, [account, market, metrics, protocolAdapter, prover])

  const submitTransaction = React.useCallback(async () => {
    if (
      !account ||
      !canSubmitTransaction({
        metrics,
        simulationStatus: flow.simulationStatus,
        status: flow.verification.status,
        transactionPayload: flow.transactionPayload,
      })
    ) {
      return
    }

    const payload = flow.transactionPayload
    if (!payload) return

    submitAbortRef.current?.abort()
    const controller = new AbortController()
    submitAbortRef.current = controller
    const { signal } = controller

    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus: "Signing",
    }))

    const signResult = await protocolAdapter.signTransaction(
      { account: account.wallet.address, payload },
      signal
    )

    if (signal.aborted) return
    if (!signResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transactionStatus: "Failed",
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
        transactionStatus: "Failed",
      }))
      return
    }

    const submittedPayload = submitResult.value

    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionPayload: submittedPayload,
      transactionStatus: "Submitted",
    }))
    setActivity((currentActivity) =>
      appendBorrowActivity(
        currentActivity,
        createTransactionSubmittedActivity({ status: submittedPayload.status })
      )
    )

    const waitResult = await protocolAdapter.waitForConfirmation(
      { payload: submittedPayload },
      signal
    )

    if (signal.aborted) return
    if (!waitResult.ok) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        transactionStatus: "Failed",
      }))
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionReceipt: waitResult.value,
      transactionStatus: "Confirmed",
    }))
  }, [account, flow, metrics, protocolAdapter])

  const refreshTransaction = React.useCallback(() => {
    // Confirmation now flows automatically via waitForConfirmation.
    // Kept for consumer API compatibility until the refresh button UX is retired.
  }, [])

  return {
    activity,
    flow,
    metrics,
    position,
    refreshTransaction,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  }
}
