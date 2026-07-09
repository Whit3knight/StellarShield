import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { INITIAL_FLOW_STATE } from "../constants"
import type { BorrowField, BorrowFlowMetrics, BorrowFlowState } from "../types"
import {
  canSubmitTransaction,
  createBorrowProof,
  getBorrowFlowMetrics,
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
        proof: null,
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
        proof: createBorrowProof({ market, metrics }),
        verificationStatus: "Failed",
      }))
      return
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      proof: null,
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

      setFlow((currentFlow) => ({
        ...currentFlow,
        proof,
        verificationStatus: proof.status,
      }))
    }, 900)

    verificationTimerRefs.current = [preparingTimer, verifiedTimer]
  }, [market, metrics])

  const refreshTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus:
        currentFlow.transactionStatus === "Submitted"
          ? "Confirmed"
          : currentFlow.transactionStatus,
    }))
  }, [])

  const submitTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus: canSubmitTransaction({
        metrics,
        status: currentFlow.verificationStatus,
      })
        ? "Submitted"
        : currentFlow.transactionStatus,
    }))
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
