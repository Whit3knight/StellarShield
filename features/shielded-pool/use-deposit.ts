"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import { upsertNote, type ShieldedAsset, type ShieldedNote } from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { prepareDeposit } from "./deposit"
import { createToastTracker, describeError } from "./hook-utils"

type Status = "idle" | "proving" | "signing" | "success" | "failed"

type UseDepositResult = {
  deposit: (asset: ShieldedAsset) => Promise<{
    index: number
    note: ShieldedNote
    txHash: string
  } | null>
  message: string | null
  reset: () => void
  status: Status
}

/**
 * Runs a full shielded-deposit flow: derive identity from the wallet
 * seed, generate a Groth16 proof, sign the deposit_shielded tx via
 * Freighter, upsert the note into local inventory. Returns the leaf
 * index and tx hash.
 */
export function useDeposit(
  account: string | null,
  walletSeed: Uint8Array | null
): UseDepositResult {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
  }, [])

  const deposit = React.useCallback(
    async (asset: ShieldedAsset) => {
      if (!account || !walletSeed) {
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

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: "Generating deposit proof",
          description: "Poseidon witness + Groth16 (a few seconds)…",
          type: "loading",
        })
      )
      setStatus("proving")
      setMessage(null)

      try {
        const prepared = await prepareDeposit({
          account,
          asset,
          walletSeed,
        })

        setStatus("signing")
        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: "Approve the deposit_shielded call in Freighter.",
            type: "loading",
          })
        )

        const bindings = await import("@/features/protocol/bindings/borrow-pool")
        const client = new bindings.Client({
          contractId,
          networkPassphrase: getConfiguredNetworkPassphrase(),
          rpcUrl: getConfiguredSorobanRpcUrl(),
          publicKey: account,
        })

        const proofBuffers = {
          a: Buffer.from(prepared.proof.a),
          b: Buffer.from(prepared.proof.b),
          c: Buffer.from(prepared.proof.c),
          oracle_epoch: BigInt(0),
          public_signals: prepared.proof.publicSignals.map((bytes) =>
            bigintFromBytes(bytes)
          ),
        }

        const assembled = await client.deposit_shielded({
          from: account,
          asset,
          proof: proofBuffers,
          memo: Buffer.from(prepared.memo),
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
        const indexResult = sent.result as unknown as
          | { tag: "Ok"; values: readonly [bigint] }
          | { tag: "Err"; error: { message: string } }
        if (indexResult && "tag" in indexResult && indexResult.tag === "Err") {
          throw new Error(indexResult.error.message)
        }
        const leafIndex = Number(
          (indexResult as { tag: "Ok"; values: readonly [bigint] })?.values?.[0] ?? 0n
        )

        const stored: ShieldedNote = { ...prepared.note, index: leafIndex }
        upsertNote(stored)
        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: "Shielded deposit confirmed",
          description: `Note #${leafIndex} committed.`,
          type: "success",
          timeout: 6_000,
          actionProps: {
            children: "View Transaction",
            onClick: () => window.open(getStellarExpertTxUrl(hash), "_blank"),
          },
        })
        return { index: leafIndex, note: stored, txHash: hash }
      } catch (cause) {
        toast.close()
        const { title, description, rejected } = describeError(
          cause,
          "Deposit failed"
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
    [account, walletSeed]
  )

  return { deposit, message, reset, status }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
