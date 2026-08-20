"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import { formatRawAmount } from "@/features/markets"
import {
  DENOMINATION,
  type ShieldedNote,
  computeCommitment,
  upsertNote,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { createToastTracker, describeError } from "./hook-utils"
import { proveWithdraw } from "./withdraw-prover"
import { fetchDepositWitnesses, fetchLoanWitnesses } from "./withdraw-tree"

type Status = "idle" | "reconstructing" | "proving" | "signing" | "success" | "failed"

type UseWithdrawResult = {
  activeNoteIndex: number | null
  message: string | null
  reset: () => void
  status: Status
  withdraw: (note: ShieldedNote) => Promise<{ txHash: string } | null>
}

/**
 * Burns one deposit note via a zk proof, receives the fixed
 * denomination back into the connected wallet. Rebuilds the local
 * merkle tree from every deposit event to derive the note's
 * inclusion witness, then generates the proof + submits via Freighter.
 */
export function useWithdraw(account: string | null): UseWithdrawResult {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeNoteIndex, setActiveNoteIndex] = React.useState<number | null>(
    null
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
    setActiveNoteIndex(null)
  }, [])

  const withdraw = React.useCallback(
    async (note: ShieldedNote) => {
      if (!account) {
        setStatus("failed")
        setMessage("Connect a wallet first.")
        return null
      }

      const contractId = getConfiguredContractId()
      if (!contractId) {
        setStatus("failed")
        setMessage("Contract not configured.")
        return null
      }

      setActiveNoteIndex(note.index)
      setMessage(null)

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: "Reconstructing shielded tree",
          description: "Scanning deposit events for inclusion witness…",
          type: "loading",
        })
      )

      try {
        setStatus("reconstructing")
        // Always rebuild against the CURRENT tree state. The witness
        // cached at deposit-time carries the root as of that append —
        // every later deposit shifts the root, and the contract only
        // accepts the current one, so the cached path fails simulation
        // with InvalidProof for any note that isn't the newest leaf.
        // The rebuild path backfills expired events from local notes
        // and verifies its root against the chain before returning.
        const wanted = new Set([note.index])
        const witnesses =
          note.tree === "loan"
            ? await fetchLoanWitnesses(note.asset, undefined, wanted)
            : await fetchDepositWitnesses(note.asset, undefined, wanted)
        const commitment = computeCommitment(note)
        const witness = witnesses.find(
          (candidate) =>
            candidate.leafIndex === note.index && candidate.leaf === commitment
        )
        if (!witness) {
          throw new Error(
            `No matching ${note.tree} event found for note #${note.index}. Tree may have advanced beyond RPC retention.`
          )
        }
        toast.set(
          toastManager.add({
            title: "Generating withdraw proof",
            description: "Merkle inclusion + nullifier…",
            type: "loading",
          })
        )
        setStatus("proving")
        const proof = await proveWithdraw({
          depositRoot: witness.root,
          note,
          pathBits: witness.pathBits,
          pathElements: witness.pathElements,
        })
        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: "Approve withdraw_shielded in Freighter.",
            type: "loading",
          })
        )
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

        const assembled =
          note.tree === "loan"
            ? await client.withdraw_loan_shielded({
                to: account,
                asset: note.asset,
                proof: proofBuffers,
              })
            : await client.withdraw_shielded({
                to: account,
                asset: note.asset,
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
        // Tombstone locally — the nullifier is burned on-chain, and
        // without events the scanner can't discover that on its own.
        // Keeps the balance honest and blocks a ProofReplayed retry.
        upsertNote({ ...note, spent: true })
        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title:
            note.tree === "loan"
              ? `Withdrew loan (${formatRawAmount(note.amount, note.asset)} ${note.asset})`
              : `Withdrew ${formatRawAmount(DENOMINATION[note.asset], note.asset)} ${note.asset}`,
          description: `Nullifier posted, note burned.`,
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
          "Withdraw failed"
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

  return { activeNoteIndex, message, reset, status, withdraw }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
