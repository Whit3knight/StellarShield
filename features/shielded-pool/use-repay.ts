"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  computeCommitment,
  type ShieldedNote,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { proveRepay } from "./repay-prover"
import { fetchDepositWitnesses, fetchLoanWitnesses } from "./withdraw-tree"

type Status =
  | "idle"
  | "reconstructing"
  | "proving"
  | "signing"
  | "success"
  | "failed"

type UseRepayResult = {
  activeLoanIndex: number | null
  message: string | null
  reset: () => void
  status: Status
  repay: (
    loanNote: ShieldedNote,
    depositNote: ShieldedNote
  ) => Promise<{ txHash: string } | null>
}

/**
 * Burn one loan note + one same-asset deposit note whose amount
 * covers the loan. Both nullifiers land on-chain; the collateral that
 * was consumed during borrow stays burned (no recovery in v1). The
 * repayer accepts giving up a deposit note worth >= loan amount in
 * exchange for closing the debt.
 */
export function useRepay(account: string | null): UseRepayResult {
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

  const repay = React.useCallback(
    async (loanNote: ShieldedNote, depositNote: ShieldedNote) => {
      if (!account) {
        setStatus("failed")
        setMessage("Connect a wallet first.")
        return null
      }
      if (loanNote.asset !== depositNote.asset) {
        setStatus("failed")
        setMessage("Repay source must match loan asset.")
        return null
      }
      if (depositNote.amount < loanNote.amount) {
        setStatus("failed")
        setMessage(
          `Deposit note (${depositNote.amount.toString()}) < loan (${loanNote.amount.toString()}).`
        )
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

      const scanToast = toastManager.add({
        title: "Reconstructing shielded trees",
        description: "Rebuilding loan + deposit inclusion witnesses…",
        type: "loading",
      })

      try {
        setStatus("reconstructing")
        const [loanWitnesses, depWitnesses] = await Promise.all([
          fetchLoanWitnesses(loanNote.asset),
          fetchDepositWitnesses(depositNote.asset),
        ])

        const loanCommitment = computeCommitment(loanNote)
        const loanWitness = loanWitnesses.find(
          (w) => w.leafIndex === loanNote.index && w.leaf === loanCommitment
        )
        if (!loanWitness) {
          throw new Error(
            `No matching loan event for note #${loanNote.index}. Retention window may have rolled.`
          )
        }
        const depCommitment = computeCommitment(depositNote)
        const depWitness = depWitnesses.find(
          (w) => w.leafIndex === depositNote.index && w.leaf === depCommitment
        )
        if (!depWitness) {
          throw new Error(
            `No matching deposit event for note #${depositNote.index}. Retention window may have rolled.`
          )
        }
        try {
          toastManager.close(scanToast)
        } catch {
          // already closed
        }

        const proveToast = toastManager.add({
          title: "Generating repay proof",
          description: "2× commitment + 2× Merkle + amount range…",
          type: "loading",
        })
        setStatus("proving")
        const proof = await proveRepay({
          loanNote,
          loanRoot: loanWitness.root,
          loanPathBits: loanWitness.pathBits,
          loanPathElements: loanWitness.pathElements,
          depositNote,
          depositRoot: depWitness.root,
          depositPathBits: depWitness.pathBits,
          depositPathElements: depWitness.pathElements,
        })
        try {
          toastManager.close(proveToast)
        } catch {
          // already closed
        }

        const signToast = toastManager.add({
          title: "Sign in wallet",
          description: "Approve repay_shielded in Freighter.",
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

        const proofBuffers = {
          a: Buffer.from(proof.a),
          b: Buffer.from(proof.b),
          c: Buffer.from(proof.c),
          oracle_epoch: BigInt(0),
          public_signals: proof.publicSignals.map((bytes) =>
            bigintFromBytes(bytes)
          ),
        }

        const assembled = await client.repay_shielded({
          from: account,
          asset: loanNote.asset,
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
          title: `Repaid ${loanNote.amount.toString()} ${loanNote.asset}`,
          description: "Loan closed, both nullifiers posted.",
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
          toastManager.close(scanToast)
        } catch {
          // already closed
        }
        const detail =
          cause instanceof Error && cause.message
            ? cause.message
            : "Repay failed."
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Repay failed",
          description: detail,
          type: "error",
          timeout: 8_000,
        })
        return null
      }
    },
    [account]
  )

  return { activeLoanIndex, message, reset, status, repay }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
