"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  computeCommitment,
  type ShieldedNote,
  upsertNote,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { createToastTracker, describeError } from "./hook-utils"
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

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: "Reconstructing shielded trees",
          description: "Rebuilding loan + deposit inclusion witnesses…",
          type: "loading",
        })
      )

      try {
        setStatus("reconstructing")
        const [loanWitnesses, depWitnesses] = await Promise.all([
          fetchLoanWitnesses(
            loanNote.asset,
            undefined,
            new Set([loanNote.index])
          ),
          fetchDepositWitnesses(
            depositNote.asset,
            undefined,
            new Set([depositNote.index])
          ),
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
        const bindings = await import("@/features/protocol/bindings/borrow-pool")
        const client = new bindings.Client({
          contractId,
          networkPassphrase: getConfiguredNetworkPassphrase(),
          rpcUrl: getConfiguredSorobanRpcUrl(),
          publicKey: account,
        })

        // Track D: fetch the borrow_index snapshot pinned at open
        // and the current borrow_index. Grandfather pre-D loans by
        // treating a missing snapshot as index_now (ratio 1.0 → no
        // interest accrual applied).
        const loanCommitmentBuffer = Buffer.from(
          bigintTo32Bytes(loanCommitment)
        )
        const [snapshotFetch, indexNowFetch] = await Promise.all([
          client.borrow_index_at_open({
            loan_commitment: loanCommitmentBuffer,
          }),
          client.borrow_index({ asset: loanNote.asset }),
        ])
        const indexNowSnapshot = indexNowFetch.result
        const indexNowRead = indexNowSnapshot?.value ?? BigInt(0)
        // The borrow index accrues with ledger time and the contract
        // re-accrues it when this tx executes — minutes after we read
        // it, since proving is slow. The contract accepts an index at
        // least as accrued as its own, so project forward: +0.01%
        // covers hours of accrual at the max rate, and overshooting
        // only makes the circuit's debt check stricter on us.
        const borrowIndexNow =
          indexNowRead === BigInt(0)
            ? BigInt(0)
            : indexNowRead + indexNowRead / BigInt(10_000)
        if (borrowIndexNow === BigInt(0)) {
          // Uninitialised asset — reject rather than let the circuit's
          // 0 × anything ≥ 0 comparison pass with a dust deposit.
          throw new Error(
            `borrow_index for ${loanNote.asset} is uninitialised. Contract admin must set rate params before repay.`
          )
        }
        const rawSnapshot = snapshotFetch.result
        const borrowIndexSnapshot =
          rawSnapshot === undefined || rawSnapshot === null
            ? borrowIndexNow
            : rawSnapshot

        toast.set(
          toastManager.add({
            title: "Generating repay proof",
            description: "2× commitment + 2× Merkle + accrued-debt check…",
            type: "loading",
          })
        )
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
          borrowIndexSnapshot,
          borrowIndexNow,
        })
        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: "Approve repay_shielded in Freighter.",
            type: "loading",
          })
        )
        setStatus("signing")

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
          loan_commitment: loanCommitmentBuffer,
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

        toast.close()

        const hash = sent.sendTransactionResponse?.hash ?? ""
        // Both nullifiers are burned on-chain; without events the
        // scanner can't see that. Tombstone locally so the loan stops
        // rendering as open and a retry can't hit ProofReplayed.
        upsertNote({ ...loanNote, spent: true })
        upsertNote({ ...depositNote, spent: true })
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
        toast.close()
        const { title, description, rejected } = describeError(
          cause,
          "Repay failed"
        )
        setStatus("failed")
        setMessage(description)
        toastManager.add({
          title,
          description,
          type: rejected ? "info" : "error",
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

function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let residue = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(residue & 0xffn)
    residue >>= 8n
  }
  return out
}
