"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  COLLATERAL_NOTES_PER_BORROW,
  computeNullifier,
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
    // Exclude notes with `amount === 0`: those are the local
    // "spent" tombstones this hook itself writes after a successful
    // borrow. Scanner drops them once the corresponding withdraw /
    // borrow nullifier lands, but until then a subsequent borrow that
    // picked them up again would fail
    // `collateral amount mismatch: expected N, saw 0` in the prover.
    () => notes.filter((note) => note.tree === "deposit" && note.amount > 0n),
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

      // Fresh cache view — filter by asset + `amount > 0n` (tombstones
      // land at zero after a successful borrow) and hand off the top
      // `COLLATERAL_NOTES_PER_BORROW`.
      const assetPool = availableCollateral.filter(
        (note) => note.asset === collateralAsset
      )
      let collateralNotes = assetPool.slice(0, COLLATERAL_NOTES_PER_BORROW)

      // Pre-flight nullifier check against the contract. Scanner runs
      // this too during rescans, but a mid-flow `useBorrow` invocation
      // may be reading from a cache that hasn't rehydrated yet — a
      // stale note that made it into `collateralNotes` here would trip
      // Error(#2) ProofReplayed at simulation. Query the chain now,
      // drop any that come back spent, and try to backfill from the
      // rest of the asset pool.
      try {
        const bindings = await import(
          "@/features/protocol/bindings/borrow-pool"
        )
        const client = new bindings.Client({
          contractId,
          networkPassphrase: getConfiguredNetworkPassphrase(),
          rpcUrl: getConfiguredSorobanRpcUrl(),
          publicKey: account,
        })
        const nullifiers = collateralNotes.map((n) =>
          computeNullifier(n.sk, n.index)
        )
        const buffers = nullifiers.map((n) => Buffer.from(bigintToBytes32(n)))
        const preflight = await client.nullifiers_used({
          nullifiers: buffers,
        })
        const spentFlags = (preflight.result ?? []) as boolean[]
        const stillLive: ShieldedNote[] = []
        for (let i = 0; i < collateralNotes.length; i++) {
          if (!spentFlags[i]) {
            stillLive.push(collateralNotes[i])
          }
        }
        if (stillLive.length < collateralNotes.length) {
          // Try to backfill with the next slice of the asset pool.
          const dropped = new Set(
            collateralNotes.filter((_, i) => spentFlags[i]).map((n) => n.index)
          )
          for (const cand of assetPool) {
            if (stillLive.length >= COLLATERAL_NOTES_PER_BORROW) break
            if (dropped.has(cand.index)) continue
            if (stillLive.some((s) => s.index === cand.index)) continue
            stillLive.push(cand)
          }
          collateralNotes = stillLive
        }
      } catch (cause) {
        console.error(
          "[borrow] preflight nullifier check failed",
          cause instanceof Error ? cause.message : cause
        )
      }

      if (collateralNotes.length < COLLATERAL_NOTES_PER_BORROW) {
        const detail = `Need ${COLLATERAL_NOTES_PER_BORROW} unspent ${collateralAsset} deposit notes; only ${collateralNotes.length} available. Deposit fresh collateral and retry.`
        setStatus("failed")
        setMessage(detail)
        toastManager.add({
          title: "Not enough collateral",
          description: detail,
          type: "error",
          timeout: 6_000,
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

function bigintToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let v = value
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
