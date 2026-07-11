"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import { getStellarExpertTxUrl } from "@/features/wallet/network"

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
      const pendingToast = toastManager.add({
        title: "Repaying position",
        description: "Confirm the close in your wallet extension.",
        type: "loading",
      })

      const closePendingToast = () => {
        try {
          toastManager.close(pendingToast)
        } catch {
          // toast already closed
        }
      }

      try {
        const result = await repayPosition(account, proofId, controller.signal)
        if (controller.signal.aborted) {
          closePendingToast()
          return null
        }

        closePendingToast()
        if (result.ok) {
          setState({
            activeProofId: proofId,
            hash: result.hash,
            message: null,
            status: "success",
          })
          toastManager.add({
            title: "Position closed",
            description: `Repay confirmed. Hash ${result.hash.slice(0, 10)}…`,
            type: "success",
            timeout: 6_000,
            actionProps: {
              children: "View Transaction",
              onClick: () =>
                window.open(getStellarExpertTxUrl(result.hash), "_blank"),
            },
          })
        } else {
          setState({
            activeProofId: proofId,
            hash: null,
            message: result.message,
            status: "failed",
          })
          toastManager.add({
            title: "Repay failed",
            description: result.message,
            type: "error",
            timeout: 8_000,
          })
        }
        return result
      } catch (cause) {
        if (controller.signal.aborted) {
          closePendingToast()
          return null
        }
        closePendingToast()
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
        toastManager.add({
          title: "Repay failed",
          description: message,
          type: "error",
          timeout: 8_000,
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
