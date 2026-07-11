"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import { type ShieldedNote } from "@/features/notes"
import { fetchReflectorPrice } from "@/features/markets/prices"
import { getRiskParams } from "@/features/protocol/risk-params"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { proveLiquidate } from "./liquidate-prover"

type Status =
  | "idle"
  | "pricing"
  | "proving"
  | "signing"
  | "success"
  | "failed"

type UseLiquidateResult = {
  activeLoanIndex: number | null
  message: string | null
  reset: () => void
  status: Status
  liquidate: (loanNote: ShieldedNote) => Promise<{ txHash: string } | null>
}

/**
 * Trigger a shielded liquidation on a loan note whose memo openings
 * are available (borrower's own loan or a note handed to the caller
 * by the liquidation service). Fetches the current Reflector price,
 * asserts the position is underwater, generates the Groth16 proof,
 * signs + submits `liquidate_shielded`. No bounty payout in v1 —
 * successful liquidation just burns the loan nullifier so the borrower
 * can't claim the loan amount downstream.
 */
export function useLiquidate(account: string | null): UseLiquidateResult {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeLoanIndex, setActiveLoanIndex] = React.useState<number | null>(
    null
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
    setActiveLoanIndex(null)
  }, [])

  const liquidate = React.useCallback(
    async (loanNote: ShieldedNote) => {
      if (!account) {
        setStatus("failed")
        setMessage("Connect a wallet first.")
        return null
      }
      if (loanNote.tree !== "loan" || !loanNote.bond) {
        setStatus("failed")
        setMessage("This loan has no liquidation bond (pre-Track-L borrow).")
        return null
      }

      const contractId = getConfiguredContractId()
      if (!contractId) {
        setStatus("failed")
        setMessage("Contract not configured.")
        return null
      }

      setActiveLoanIndex(loanNote.index)
      setMessage(null)

      const priceToast = toastManager.add({
        title: "Reading current price",
        description: "Fetching Reflector oracle for underwater check…",
        type: "loading",
      })

      try {
        setStatus("pricing")
        const priceRecord = await fetchReflectorPrice(loanNote.asset)
        if (!priceRecord || priceRecord.price <= 0n) {
          throw new Error(
            `Reflector returned no price for ${loanNote.asset}. Retry when the feed refreshes.`
          )
        }
        try {
          toastManager.close(priceToast)
        } catch {
          // already closed
        }

        const risk = await getRiskParams()

        const proveToast = toastManager.add({
          title: "Generating liquidate proof",
          description: "3 bond commits + underwater range check…",
          type: "loading",
        })
        setStatus("proving")
        const proof = await proveLiquidate({
          loanAsset: loanNote.asset,
          loanAmount: loanNote.amount,
          loanSalt: loanNote.salt,
          loanIndex: loanNote.index,
          sk: loanNote.sk,
          bondSaltAmount: loanNote.bond.saltAmount,
          bondSaltValue: loanNote.bond.saltValue,
          bondSaltPrice: loanNote.bond.saltPrice,
          collateralNotional: loanNote.bond.collateralValue,
          borrowPrice: loanNote.bond.borrowPrice,
          currentPrice: priceRecord.price,
          thresholdBps: risk.liquidationThresholdBps,
        })
        try {
          toastManager.close(proveToast)
        } catch {
          // already closed
        }

        const signToast = toastManager.add({
          title: "Sign in wallet",
          description: "Approve liquidate_shielded in Freighter.",
          type: "loading",
        })
        setStatus("signing")
        const bindings = await import("@/features/protocol/bindings/borrow-pool")
        const client = new bindings.Client({
          contractId,
          networkPassphrase: getConfiguredNetworkPassphrase(),
          rpcUrl: getConfiguredSorobanRpcUrl(),
          publicKey: account,
        })

        const nowSecs = BigInt(Math.floor(Date.now() / 1000))
        const proofBuffers = {
          a: Buffer.from(proof.a),
          b: Buffer.from(proof.b),
          c: Buffer.from(proof.c),
          oracle_epoch: nowSecs,
          public_signals: proof.publicSignals.map((bytes) =>
            bigintFromBytes(bytes)
          ),
        }

        const assembled = await client.liquidate_shielded({
          liquidator: account,
          borrow_asset: loanNote.asset,
          proof: proofBuffers,
        })

        const { signTransaction: freighter } = await import(
          "@stellar/freighter-api"
        )
        const sent = await assembled.signAndSend({
          signTransaction: (async (
            xdrToSign: string,
            opts?: { address?: string; networkPassphrase?: string }
          ) => {
            return freighter(xdrToSign, {
              address: opts?.address ?? account,
              networkPassphrase:
                opts?.networkPassphrase ?? getConfiguredNetworkPassphrase(),
            })
          }) as unknown as Parameters<
            typeof assembled.signAndSend
          >[0] extends undefined
            ? never
            : NonNullable<
                Parameters<typeof assembled.signAndSend>[0]
              >["signTransaction"],
        })

        try {
          toastManager.close(signToast)
        } catch {
          // already closed
        }

        const hash = sent.sendTransactionResponse?.hash ?? ""
        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: `Liquidated loan #${loanNote.index}`,
          description: "Nullifier posted, pool retains collateral.",
          type: "success",
          timeout: 6_000,
          actionProps: {
            children: "View Transaction",
            onClick: () => window.open(getStellarExpertTxUrl(hash), "_blank"),
          },
        })
        return { txHash: hash }
      } catch (cause) {
        try {
          toastManager.close(priceToast)
        } catch {
          // already closed
        }
        const detail =
          cause instanceof Error && cause.message
            ? cause.message
            : "Liquidate failed."
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Liquidate failed",
          description: detail,
          type: "error",
          timeout: 8_000,
        })
        return null
      }
    },
    [account]
  )

  return { activeLoanIndex, message, reset, status, liquidate }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
