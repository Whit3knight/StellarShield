"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  upsertNote,
  useNotes,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { prepareBorrow } from "./borrow"

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

// Contract-configured risk params — kept here temporarily so the hook
// doesn't need an extra RPC round trip per borrow. When the frontend
// gains a `useRiskParams()` reader wired to the bindings' `risk_params`
// view, swap these in.
const HF_MIN_BPS = 12_500
const MAX_LTV_BPS = 6_250

/**
 * Runs a full shielded-borrow flow: picks 4 deposit notes of the
 * requested collateral asset, reconstructs their inclusion witnesses,
 * generates the Groth16 proof, signs + submits borrow_shielded via
 * Freighter, upserts the freshly minted loan note into local
 * inventory. Returns the tx hash on success.
 */
export function useBorrow(
  account: string | null,
  walletSeed: Uint8Array | null
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

      const collateralNotes = availableCollateral
        .filter((note) => note.asset === collateralAsset)
        .slice(0, 4)
      if (collateralNotes.length < 4) {
        const detail = `Need 4 ${collateralAsset} deposit notes; only ${collateralNotes.length} available.`
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

      const reconstructToast = toastManager.add({
        title: "Reconstructing collateral witnesses",
        description: "Rebuilding the deposit tree + fetching Reflector price…",
        type: "loading",
      })
      setStatus("reconstructing")
      setMessage(null)

      try {
        // prepareBorrow already handles the witness fetch + oracle
        // read + proof generation. We split the toast lifecycle here
        // so users get progress cues at each big stage.
        try {
          toastManager.close(reconstructToast)
        } catch {
          // already closed
        }

        const proveToast = toastManager.add({
          title: "Generating borrow proof",
          description: "Merkle × 4 + LTV + nullifiers (~10-15s)…",
          type: "loading",
        })
        setStatus("proving")

        const prepared = await prepareBorrow({
          account,
          borrowAsset,
          collateralAsset,
          collateralNotes,
          hfMinBps: HF_MIN_BPS,
          maxLtvBps: MAX_LTV_BPS,
          walletSeed,
        })

        try {
          toastManager.close(proveToast)
        } catch {
          // already closed
        }

        const signToast = toastManager.add({
          title: "Sign in wallet",
          description: "Approve borrow_shielded in Freighter.",
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

        try {
          toastManager.close(signToast)
        } catch {
          // already closed
        }

        const hash = sent.sendTransactionResponse?.hash ?? ""
        const indexResult = sent.result as unknown as
          | { tag: "Ok"; values: readonly [bigint] }
          | { tag: "Err"; error: { message: string } }
        if (indexResult && "tag" in indexResult && indexResult.tag === "Err") {
          throw new Error(indexResult.error.message)
        }
        const loanIndex = Number(
          (indexResult as { tag: "Ok"; values: readonly [bigint] })?.values?.[0] ?? 0n
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
        try {
          toastManager.close(reconstructToast)
        } catch {
          // already closed
        }
        const detail =
          cause instanceof Error && cause.message
            ? cause.message
            : "Borrow failed."
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Borrow failed",
          description: detail,
          type: "error",
          timeout: 8_000,
        })
        return null
      }
    },
    [account, availableCollateral, walletSeed]
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
