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

import { emitDepositConfirmed } from "@/features/borrow-flow/borrow-events"
import type { ScanIdentity } from "@/features/notes"

import { prepareDeposit } from "./deposit"
import { createToastTracker, describeError } from "./hook-utils"

type Status = "idle" | "proving" | "signing" | "success" | "failed"

type UseDepositResult = {
  deposit: (asset: ShieldedAsset) => Promise<{
    index: number
    note: ShieldedNote
    txHash: string
  } | null>
  depositBatch: (
    asset: ShieldedAsset,
    count: number
  ) => Promise<{
    notes: ShieldedNote[]
    txHash: string
    indexes: number[]
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
  identity: ScanIdentity | null
): UseDepositResult {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
  }, [])

  const deposit = React.useCallback(
    async (asset: ShieldedAsset) => {
      if (!account || !identity) {
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
          identity,
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
        // `sent.result` is an `Ok<bigint>` / `Err<...>` from
        // @stellar/stellar-sdk's rust_result — access via `.value` /
        // `.error`, NOT `{tag, values}` (that shape belongs to the
        // XDR discriminated union, not the SDK's Result wrapper).
        // Getting this wrong pins every deposit's leafIndex at 0.
        const indexResult = sent.result as unknown as
          | { value: bigint; isOk?: () => boolean }
          | { error: { message: string }; isErr?: () => boolean }
        if (indexResult && "error" in indexResult) {
          throw new Error(indexResult.error.message)
        }
        const leafIndex = Number(
          "value" in indexResult ? indexResult.value : 0n
        )

        const stored: ShieldedNote = { ...prepared.note, index: leafIndex }
        upsertNote(stored)
        // Trigger a rescan so the note picks up its authoritative
        // index from the DEPOSIT_EVENT body — the SDK Ok<u64> value
        // above is correct now, but the scanner also enforces spent-
        // nullifier + memo dedupe so we always converge on the same
        // inventory a fresh browser reload would produce.
        emitDepositConfirmed(hash)
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
    [account, identity]
  )

  const depositBatch = React.useCallback(
    async (asset: ShieldedAsset, count: number) => {
      if (!account || !identity) {
        setStatus("failed")
        setMessage("Connect a wallet first.")
        return null
      }
      if (count <= 0) return { notes: [], txHash: "", indexes: [] }

      const contractId = getConfiguredContractId()
      if (!contractId) {
        setStatus("failed")
        setMessage("Contract not configured.")
        return null
      }

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: `Generating ${count} deposit proofs`,
          description: "Poseidon witness + Groth16 per note…",
          type: "loading",
        })
      )
      setStatus("proving")
      setMessage(null)

      try {
        const prepared = []
        for (let i = 0; i < count; i++) {
          prepared.push(
            await prepareDeposit({ account, asset, identity })
          )
        }

        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: `Approve deposit_shielded_batch for ${count} notes.`,
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

        const proofsArr = prepared.map((p) => ({
          a: Buffer.from(p.proof.a),
          b: Buffer.from(p.proof.b),
          c: Buffer.from(p.proof.c),
          oracle_epoch: BigInt(0),
          public_signals: p.proof.publicSignals.map(bigintFromBytes),
        }))
        const memosArr = prepared.map((p) => Buffer.from(p.memo))

        const assembled = await client.deposit_shielded_batch({
          from: account,
          asset,
          proofs: proofsArr,
          memos: memosArr,
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
          | { value: unknown[] }
          | { error: { message: string } }
        if (indexResult && "error" in indexResult) {
          throw new Error(indexResult.error.message)
        }
        const rawIndexes =
          "value" in indexResult ? (indexResult.value as unknown[]) : []
        const indexes = rawIndexes.map((v) => Number(v as bigint))

        const notesOut: ShieldedNote[] = prepared.map((p, i) => {
          const stored: ShieldedNote = {
            ...p.note,
            index: indexes[i] ?? p.note.index,
          }
          upsertNote(stored)
          return stored
        })
        emitDepositConfirmed(hash)

        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: `Shielded deposit batch confirmed`,
          description: `${notesOut.length} notes minted.`,
          type: "success",
          timeout: 6_000,
          actionProps: {
            children: "View Transaction",
            onClick: () => window.open(getStellarExpertTxUrl(hash), "_blank"),
          },
        })
        return { notes: notesOut, txHash: hash, indexes }
      } catch (cause) {
        toast.close()
        const { title, description, rejected } = describeError(
          cause,
          "Deposit batch failed"
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
    [account, identity]
  )

  return { deposit, depositBatch, message, reset, status }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
