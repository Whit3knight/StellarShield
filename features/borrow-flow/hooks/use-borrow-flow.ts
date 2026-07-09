import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"
import type { ProtocolAdapter } from "@/features/protocol"
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
  createBorrowProof,
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
  submitTransaction: () => void
  verifyEligibility: () => void
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
  const verificationTimerRefs = React.useRef<
    Array<ReturnType<typeof setTimeout>>
  >([])
  const connectedWalletRef = React.useRef<string | null>(null)
  const confirmedPayloadRef = React.useRef<string | null>(null)
  const metrics = React.useMemo(
    () => getBorrowFlowMetrics(flow, market, account),
    [account, flow, market]
  )

  React.useEffect(() => {
    return () => {
      clearVerificationTimers(verificationTimerRefs.current)
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

  const verifyEligibility = React.useCallback(() => {
    clearVerificationTimers(verificationTimerRefs.current)

    if (!metrics.isLoanValid) {
      const proof = createBorrowProof({ account, market, metrics, prover })

      setFlow((currentFlow) => ({
        ...currentFlow,
        borrowIntent: null,
        simulationStatus: "Idle",
        transactionPayload: null,
        transactionReceipt: null,
        transactionStatus: "Draft",
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

    setFlow((currentFlow) => ({
      ...currentFlow,
      borrowIntent: null,
      simulationStatus: "Idle",
      transactionPayload: null,
      transactionReceipt: null,
      transactionStatus: "Draft",
      verification: { status: "Preparing" },
    }))

    const preparingTimer = setTimeout(() => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verification: { status: "Generating proof" },
      }))
    }, 350)
    const verifiedTimer = setTimeout(() => {
      const proof = createBorrowProof({ account, market, metrics, prover })
      const intent = createBorrowIntentFromFlow({
        account,
        adapter: protocolAdapter,
        metrics,
        proof,
      })
      const simulation = simulateBorrowIntentFromFlow({
        adapter: protocolAdapter,
        intent,
        metrics,
      })
      const nextVerification: Verification =
        proof.status === "Verified"
          ? { status: "Verified", proof }
          : { status: "Failed", proof }

      setFlow((currentFlow) => ({
        ...currentFlow,
        borrowIntent: intent,
        simulationStatus: simulation.status,
        transactionPayload: simulation.payload,
        transactionReceipt: null,
        transactionStatus: simulation.status === "Ready" ? "Ready" : "Draft",
        verification: nextVerification,
      }))
      setActivity((currentActivity) => {
        let nextActivity = appendBorrowActivity(
          currentActivity,
          createProofGeneratedActivity({ proof })
        )

        if (intent) {
          nextActivity = appendBorrowActivity(
            nextActivity,
            createIntentPreparedActivity({ intent })
          )
        }

        return nextActivity
      })
    }, 900)

    verificationTimerRefs.current = [preparingTimer, verifiedTimer]
  }, [account, market, metrics, protocolAdapter, prover])

  const refreshTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      ...getRefreshedTransactionState(currentFlow, protocolAdapter),
    }))
  }, [protocolAdapter])

  const submitTransaction = React.useCallback(() => {
    const canSubmit = canSubmitTransaction({
      metrics,
      simulationStatus: flow.simulationStatus,
      status: flow.verification.status,
      transactionPayload: flow.transactionPayload,
    })

    if (!canSubmit) {
      return
    }

    const submitted = protocolAdapter.submitTransaction({
      payload: flow.transactionPayload,
    })

    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionPayload: submitted.payload,
      transactionReceipt: submitted.receipt,
      transactionStatus: submitted.status,
    }))
    setActivity((currentActivity) =>
      appendBorrowActivity(
        currentActivity,
        createTransactionSubmittedActivity({ status: submitted.status })
      )
    )
  }, [flow, metrics, protocolAdapter])

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

function clearVerificationTimers(
  timers: Array<ReturnType<typeof setTimeout>>
): void {
  timers.forEach((timer) => {
    clearTimeout(timer)
  })
  timers.length = 0
}

function getRefreshedTransactionState(
  flow: BorrowFlowState,
  adapter: ProtocolAdapter
): Pick<
  BorrowFlowState,
  "transactionPayload" | "transactionReceipt" | "transactionStatus"
> {
  if (flow.transactionStatus === "Draft") {
    return {
      transactionPayload: flow.transactionPayload,
      transactionReceipt: flow.transactionReceipt,
      transactionStatus: flow.transactionStatus,
    }
  }

  const refreshed = adapter.refreshTransaction({
    payload: flow.transactionPayload,
  })

  return {
    transactionPayload: refreshed.payload,
    transactionReceipt: refreshed.receipt ?? flow.transactionReceipt,
    transactionStatus: refreshed.status,
  }
}
