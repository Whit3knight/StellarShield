"use client"

import * as React from "react"

import { repayPosition, type RepayResult } from "./repay-position"

type Status = "idle" | "pending" | "success" | "failed"

type RepayState = {
  activeProofId: string | null
  hash: string | null
  message: string | null
  status: Status
}

const INITIAL: RepayState = {
  activeProofId: null,
  hash: null,
  message: null,
  status: "idle",
}

/**
 * Owns Freighter signing + submit for `repay(account, proof_id)`. UI
 * consumers call `repay(proofId)`, observe `status` for pending/failed
 * transitions, and reload their chain-derived positions on success.
 */
export function useRepayPosition(account: string | null): {
  activeProofId: string | null
  hash: string | null
  message: string | null
  repay: (proofId: string) => Promise<RepayResult | null>
  reset: () => void
  status: Status
} {
  const [state, setState] = React.useState<RepayState>(INITIAL)
  const abortRef = React.useRef<AbortController | null>(null)

  const reset = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(INITIAL)
  }, [])

  React.useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  const repay = React.useCallback(
    async (proofId: string): Promise<RepayResult | null> => {
      if (!account) return null

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState({
        activeProofId: proofId,
        hash: null,
        message: null,
        status: "pending",
      })

      try {
        const result = await repayPosition(account, proofId, controller.signal)
        if (controller.signal.aborted) return null

        if (result.ok) {
          setState({
            activeProofId: proofId,
            hash: result.hash,
            message: null,
            status: "success",
          })
        } else {
          setState({
            activeProofId: proofId,
            hash: null,
            message: result.message,
            status: "failed",
          })
        }
        return result
      } catch (cause) {
        if (controller.signal.aborted) return null
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : "Repay transaction failed."
        setState({
          activeProofId: proofId,
          hash: null,
          message,
          status: "failed",
        })
        return { ok: false, message }
      }
    },
    [account]
  )

  return {
    activeProofId: state.activeProofId,
    hash: state.hash,
    message: state.message,
    repay,
    reset,
    status: state.status,
  }
}
