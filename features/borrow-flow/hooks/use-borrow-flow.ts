import * as React from "react"

import { INITIAL_FLOW_STATE } from "../constants"
import type { BorrowField, BorrowFlowMetrics, BorrowFlowState } from "../types"
import { getBorrowFlowMetrics } from "../utils"

type BorrowFlowControls = {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  refreshTransaction: () => void
  setFieldValue: (field: BorrowField, value: string) => void
  submitTransaction: () => void
  verifyEligibility: () => void
}

export function useBorrowFlow(): BorrowFlowControls {
  const [flow, setFlow] = React.useState<BorrowFlowState>(INITIAL_FLOW_STATE)
  const verificationTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const metrics = React.useMemo(() => getBorrowFlowMetrics(flow), [flow])

  React.useEffect(() => {
    return () => {
      if (verificationTimerRef.current) {
        clearTimeout(verificationTimerRef.current)
      }
    }
  }, [])

  const setFieldValue = React.useCallback(
    (field: BorrowField, value: string) => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        [field]: value,
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      }))
    },
    []
  )

  const verifyEligibility = React.useCallback(() => {
    if (verificationTimerRef.current) {
      clearTimeout(verificationTimerRef.current)
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      verificationStatus: "Checking",
    }))

    verificationTimerRef.current = setTimeout(() => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verificationStatus: "Verified",
      }))
    }, 650)
  }, [])

  const refreshTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus: "Confirmed",
    }))
  }, [])

  const submitTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus: "Submitted",
    }))
  }, [])

  return {
    flow,
    metrics,
    refreshTransaction,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  }
}
