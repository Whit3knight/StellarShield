"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  COLLATERAL_NOTES_PER_BORROW,
  upsertNote,
  useNotes,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { getRiskParams } from "@/features/protocol/risk-params"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import type { ScanIdentity } from "@/features/notes"

import { prepareBorrow } from "./borrow"
import { createToastTracker, describeError } from "./hook-utils"

type Status =
  | "idle"
  | "reconstructing"
  | "proving"
  | "signing"
  | "success"
  | "failed"

type UseBorrowResult = {
  availableCollateral: ShieldedNote[]
  borrow: (params: {
    borrowAsset: ShieldedAsset
    collateralAsset: ShieldedAsset
  }) => Promise<{ txHash: string } | null>
  message: string | null
  reset: () => void
  status: Status
}

// Risk params fetched from the contract via getRiskParams() and
// cached module-wide, so only the first borrow of a session pays the
// RPC round trip.

/**
 * Runs a full shielded-borrow flow: picks 4 deposit notes of the
 * requested collateral asset, reconstructs their inclusion witnesses,
 * generates the Groth16 proof, signs + submits borrow_shielded via
 * Freighter, upserts the freshly minted loan note into local
 * inventory. Returns the tx hash on success.
 */
export function useBorrow(
  account: string | null,
  identity: ScanIdentity | null
): UseBorrowResult {
  const notes = useNotes()
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  const availableCollateral = React.useMemo(
    () => notes.filter((note) => note.tree === "deposit"),
    [notes]
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
  }, [])

  const borrow = React.useCallback(
    async ({
      borrowAsset,
      collateralAsset,
    }: {
      borrowAsset: ShieldedAsset
      collateralAsset: ShieldedAsset
    }) => {
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

      const collateralNotes = availableCollateral
        .filter((note) => note.asset === collateralAsset)
        .slice(0, COLLATERAL_NOTES_PER_BORROW)
      if (collateralNotes.length < COLLATERAL_NOTES_PER_BORROW) {
        const detail = `Need ${COLLATERAL_NOTES_PER_BORROW} ${collateralAsset} deposit notes; only ${collateralNotes.length} available.`
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Not enough collateral",
          description: detail,
          type: "error",
          timeout: 5_000,
        })
        return null
      }

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: "Reconstructing collateral witnesses",
          description:
            "Rebuilding the deposit tree + fetching Reflector price…",
          type: "loading",
        })
      )
      setStatus("reconstructing")
      setMessage(null)

      try {
        // prepareBorrow already handles the witness fetch + oracle
        // read + proof generation. We split the toast lifecycle here
        // so users get progress cues at each big stage.
        toast.set(
          toastManager.add({
            title: "Generating borrow proof",
            description: "Merkle × 4 + LTV + nullifiers (~10-15s)…",
            type: "loading",
          })
        )
        setStatus("proving")

        const risk = await getRiskParams()
        const prepared = await prepareBorrow({
          account,
          borrowAsset,
          collateralAsset,
          collateralNotes,
          hfMinBps: risk.hfMinBps,
          maxLtvBps: risk.maxLtvBps,
          identity,
        })

        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: "Approve borrow_shielded in Freighter.",
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
          a: Buffer.from(prepared.proof.a),
          b: Buffer.from(prepared.proof.b),
          c: Buffer.from(prepared.proof.c),
          oracle_epoch: BigInt(0),
          public_signals: prepared.proof.publicSignals.map((bytes) =>
            bigintFromBytes(bytes)
          ),
        }

        const assembled = await client.borrow_shielded({
          from: account,
          collateral_asset: collateralAsset,
          borrow_asset: borrowAsset,
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
        // Same wrapper as deposit — SDK's rust_result Ok/Err with
        // `.value` / `.error`, not `{tag, values}`.
        const indexResult = sent.result as unknown as
          | { value: bigint }
          | { error: { message: string } }
        if (indexResult && "error" in indexResult) {
          throw new Error(indexResult.error.message)
        }
        const loanIndex = Number(
          "value" in indexResult ? indexResult.value : 0n
        )

        const stored: ShieldedNote = { ...prepared.note, index: loanIndex }
        // Collateral notes are now spent — drop them from local
        // inventory so the deposit balance updates immediately.
        for (const spent of collateralNotes) {
          upsertNote({ ...spent, tree: "deposit", amount: 0n })
        }
        upsertNote(stored)

        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: "Shielded borrow confirmed",
          description: `Loan note #${loanIndex} minted.`,
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
          "Borrow failed"
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
    [account, availableCollateral, identity]
  )

  return { availableCollateral, borrow, message, reset, status }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
