import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"
import { getNextSubmitStatus } from "@/features/protocol"

import { INITIAL_FLOW_STATE } from "../constants"
import type { BorrowField, BorrowFlowMetrics, BorrowFlowState } from "../types"
import {
  canSubmitTransaction,
  createBorrowIntentFromFlow,
  createBorrowProof,
  getBorrowFlowMetrics,
  simulateBorrowIntentFromFlow,
} from "../utils"

type BorrowFlowControls = {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
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
  const verificationTimerRefs = React.useRef<
    Array<ReturnType<typeof setTimeout>>
  >([])
  const metrics = React.useMemo(
    () => getBorrowFlowMetrics(flow, market, account),
    [account, flow, market]
  )

  React.useEffect(() => {
    return () => {
      clearVerificationTimers(verificationTimerRefs.current)
    }
  }, [])

  const setFieldValue = React.useCallback(
    (field: BorrowField, value: string) => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        [field]: value,
        borrowIntent: null,
        proof: null,
        simulationStatus: "Idle",
        transactionPayload: null,
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      }))
    },
    []
  )

  const verifyEligibility = React.useCallback(() => {
    clearVerificationTimers(verificationTimerRefs.current)

    if (!metrics.isLoanValid) {
      setFlow((currentFlow) => ({
        ...currentFlow,
        borrowIntent: null,
        proof: createBorrowProof({ market, metrics }),
        simulationStatus: "Idle",
        transactionPayload: null,
        transactionStatus: "Draft",
        verificationStatus: "Failed",
      }))
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      borrowIntent: null,
      proof: null,
      simulationStatus: "Idle",
      transactionPayload: null,
      transactionStatus: "Draft",
      verificationStatus: "Preparing",
    }))

    const preparingTimer = setTimeout(() => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verificationStatus: "Generating proof",
      }))
    }, 350)
    const verifiedTimer = setTimeout(() => {
      const proof = createBorrowProof({ market, metrics })
      const intent = createBorrowIntentFromFlow({ account, metrics, proof })
      const simulation = simulateBorrowIntentFromFlow({ intent, metrics })

      setFlow((currentFlow) => ({
        ...currentFlow,
        borrowIntent: intent,
        proof,
        simulationStatus: simulation.status,
        transactionPayload: simulation.payload,
        transactionStatus: simulation.status === "Ready" ? "Ready" : "Draft",
        verificationStatus: proof.status,
      }))
    }, 900)

    verificationTimerRefs.current = [preparingTimer, verifiedTimer]
  }, [account, market, metrics])

  const refreshTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      ...getRefreshedTransactionState(currentFlow),
    }))
  }, [])

  const submitTransaction = React.useCallback(() => {
    setFlow((currentFlow) => {
      const canSubmit = canSubmitTransaction({
        metrics,
        simulationStatus: currentFlow.simulationStatus,
        status: currentFlow.verificationStatus,
        transactionPayload: currentFlow.transactionPayload,
      })

      return {
        ...currentFlow,
        transactionPayload: canSubmit
          ? currentFlow.transactionPayload
            ? { ...currentFlow.transactionPayload, status: "Signing" }
            : null
          : currentFlow.transactionPayload,
        transactionStatus: canSubmit
          ? "Signing"
          : currentFlow.transactionStatus,
      }
    })
  }, [metrics])

  return {
    flow,
    metrics,
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
  flow: BorrowFlowState
): Pick<BorrowFlowState, "transactionPayload" | "transactionStatus"> {
  if (flow.transactionStatus === "Draft") {
    return {
      transactionPayload: flow.transactionPayload,
      transactionStatus: flow.transactionStatus,
    }
  }

  const transactionStatus = getNextSubmitStatus(flow.transactionStatus)

  return {
    transactionPayload: flow.transactionPayload
      ? { ...flow.transactionPayload, status: transactionStatus }
      : null,
    transactionStatus,
  }
}
