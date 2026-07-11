"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  DENOMINATION,
  type ShieldedNote,
  computeCommitment,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { proveWithdraw } from "./withdraw-prover"
import { fetchDepositWitnesses } from "./withdraw-tree"

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

      const reconstructToast = toastManager.add({
        title: "Reconstructing shielded tree",
        description: "Scanning deposit events for inclusion witness…",
        type: "loading",
      })

      try {
        setStatus("reconstructing")
        const witnesses = await fetchDepositWitnesses(note.asset)
        const commitment = computeCommitment(note)
        const witness = witnesses.find(
          (candidate) =>
            candidate.leafIndex === note.index && candidate.leaf === commitment
        )
        if (!witness) {
          throw new Error(
            `No matching deposit event found for note #${note.index}. Tree may have advanced beyond RPC retention.`
          )
        }
        try {
          toastManager.close(reconstructToast)
        } catch {
          // already closed
        }

        const proveToast = toastManager.add({
          title: "Generating withdraw proof",
          description: "Merkle inclusion + nullifier…",
          type: "loading",
        })
        setStatus("proving")
        const proof = await proveWithdraw({
          depositRoot: witness.root,
          note,
          pathBits: witness.pathBits,
          pathElements: witness.pathElements,
        })
        try {
          toastManager.close(proveToast)
        } catch {
          // already closed
        }

        const signToast = toastManager.add({
          title: "Sign in wallet",
          description: "Approve withdraw_shielded in Freighter.",
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

        const assembled = await client.withdraw_shielded({
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

        try {
          toastManager.close(signToast)
        } catch {
          // already closed
        }

        const hash = sent.sendTransactionResponse?.hash ?? ""
        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: `Withdrew ${DENOMINATION[note.asset]} ${note.asset}`,
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
        try {
          toastManager.close(reconstructToast)
        } catch {
          // already closed
        }
        const detail =
          cause instanceof Error && cause.message
            ? cause.message
            : "Withdraw failed."
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Withdraw failed",
          description: detail,
          type: "error",
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
