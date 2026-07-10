import { Buffer } from "buffer"

import { signXdr } from "@/features/wallet/signer"
import type { BorrowContractPayload } from "@/features/proofs"
import { createStableId } from "@/lib/stable-id"

import { err, ok, type AdapterResult, type AdapterError } from "./result"
import {
  createDefaultSorobanRpcClient,
  type SorobanRpcClient,
} from "./soroban-rpc"
import type {
  BorrowIntent,
  CreateBorrowIntentParams,
  ProtocolAdapter,
} from "./types"

/**
 * ponytail: real contract calls stay here. Every method that is not
 * pure client-side struct assembly returns Unknown until the lending
 * pool contract is deployed and its function signatures are pinned.
 * When the contract lands, replace the placeholder bodies in
 * simulateBorrow, signTransaction, submitTransaction, and
 * waitForConfirmation using the SDK submodules
 * (`@stellar/stellar-sdk/rpc`, `@stellar/stellar-sdk/contract`) via
 * dynamic import inside each method so the SDK never lands in the
 * initial chunk.
 */

export type SorobanAdapterConfig = {
  contractId: string
  horizonUrl: string
  networkPassphrase: string
  sorobanRpcUrl: string
}

export type BuildBorrowXdrInput = {
  contractProof: BorrowContractPayload
  fee: number
  intent: BorrowIntent
}

export type BuildBorrowXdr = (
  input: BuildBorrowXdrInput,
  signal?: AbortSignal
) => Promise<string>

export type SorobanAdapterDeps = {
  buildBorrowXdr?: BuildBorrowXdr
  rpcClient?: SorobanRpcClient
}

export function createSorobanProtocolAdapter(
  config: SorobanAdapterConfig,
  deps: SorobanAdapterDeps = {}
): ProtocolAdapter {
  const rpcClient =
    deps.rpcClient ?? createDefaultSorobanRpcClient(config.sorobanRpcUrl)
  const buildBorrowXdr =
    deps.buildBorrowXdr ?? createDefaultBuildBorrowXdr(config)
  return {
    createBorrowIntent: async (params, signal) => {
      if (signal?.aborted) return abortedResult()

      return ok(buildBorrowIntent(params))
    },
    simulateBorrow: async (params, signal) => {
      if (signal?.aborted) return abortedResult()

      if (!params.contractProof) {
        return err({
          tag: "InvalidInput",
          field: "contractProof",
          message:
            "simulateBorrow requires a contractProof — the Soroban adapter needs the proof bytes + oracle bindings to build the borrow tx.",
        })
      }

      // Fee is quoted in XLM by the app; the SDK expects stroops.
      const feeStroops = Math.max(1, Math.round(params.fee.amount * 10_000_000))

      let preparedXdr: string
      try {
        preparedXdr = await buildBorrowXdr(
          {
            contractProof: params.contractProof,
            fee: feeStroops,
            intent: params.intent,
          },
          signal
        )
      } catch (cause) {
        if (signal?.aborted) return abortedResult()
        return err(mapNetworkError(cause, "simulate"))
      }

      if (signal?.aborted) return abortedResult()

      const nowMs = params.now ?? Date.now()

      return ok({
        expiresAt: params.intent.expiresAt,
        fee: params.fee,
        id: createStableId(
          "payload",
          params.intent.id,
          params.intent.account,
          params.intent.borrow.symbol,
          params.intent.borrow.amount,
          nowMs.toString()
        ),
        intentId: params.intent.id,
        memo: "Stellar Shield borrow",
        network: "stellar-testnet",
        operation: "borrow",
        preparedXdr,
        status: "Ready",
      })
    },
    signTransaction: async ({ account, payload }, signal) => {
      if (signal?.aborted) return abortedResult()

      if (!payload.preparedXdr) {
        return err({
          tag: "InvalidInput",
          field: "payload.preparedXdr",
          message:
            "signTransaction requires a preparedXdr — simulateBorrow must run first for the Soroban adapter.",
        })
      }

      const signed = await signXdr({
        address: account,
        networkPassphrase: config.networkPassphrase,
        signal,
        xdr: payload.preparedXdr,
      })

      if (!signed.ok) return signed

      return ok({
        payload: { ...payload, status: "Signing" },
        signedXdr: signed.value.signedXdr,
      })
    },
    submitTransaction: async ({ payload, signedXdr }, signal) => {
      if (signal?.aborted) return abortedResult()

      if (!signedXdr) {
        return err({
          tag: "InvalidInput",
          field: "signedXdr",
          message: "submitTransaction requires a signedXdr from signTransaction.",
        })
      }

      try {
        const response = await withAbort(
          rpcClient.sendTransaction({
            networkPassphrase: config.networkPassphrase,
            signedXdr,
          }),
          signal
        )

        if (signal?.aborted) return abortedResult()

        switch (response.status) {
          case "PENDING":
          case "DUPLICATE":
            return ok({
              ...payload,
              hash: response.hash,
              status: "Submitted",
            })
          case "TRY_AGAIN_LATER":
            return err({
              tag: "Network",
              retriable: true,
              message: `Soroban RPC responded TRY_AGAIN_LATER for tx ${response.hash}. Retry shortly.`,
            })
          case "ERROR": {
            const resultCode = extractSendErrorCode(response)

            return err({
              tag: "TransactionFailed",
              hash: response.hash,
              resultCode,
              message: `Soroban RPC rejected the transaction (${resultCode}).`,
            })
          }
          default:
            return err({
              tag: "Unknown",
              message: `Unexpected sendTransaction status: ${
                (response as { status: string }).status
              }.`,
            })
        }
      } catch (cause) {
        if (signal?.aborted) return abortedResult()

        return err(mapNetworkError(cause, "submit"))
      }
    },
    waitForConfirmation: async ({ payload, timeoutMs = 60_000 }, signal) => {
      if (signal?.aborted) return abortedResult()

      if (!payload.hash) {
        return err({
          tag: "InvalidInput",
          field: "payload.hash",
          message:
            "waitForConfirmation requires payload.hash. submitTransaction populates it on success.",
        })
      }

      const hash = payload.hash
      const started = Date.now()
      const pollIntervalMs = 2_000

      try {
        while (true) {
          if (signal?.aborted) return abortedResult()

          const response = await withAbort(
            rpcClient.getTransaction(hash),
            signal
          )

          if (signal?.aborted) return abortedResult()

          if (response.status === "SUCCESS") {
            const confirmedAt = new Date(
              (response.createdAt ?? Math.floor(Date.now() / 1_000)) * 1_000
            ).toISOString()

            return ok({
              confirmedAt,
              hash,
              network: payload.network,
            })
          }

          if (response.status === "FAILED") {
            return err({
              tag: "TransactionFailed",
              hash,
              resultCode: "tx_failed",
              message: "Transaction failed on ledger.",
            })
          }

          if (Date.now() - started >= timeoutMs) {
            return err({
              tag: "Timeout",
              phase: "confirm",
              ms: timeoutMs,
            })
          }

          await sleep(pollIntervalMs, signal)
        }
      } catch (cause) {
        if (signal?.aborted) return abortedResult()

        return err(mapNetworkError(cause, "confirm"))
      }
    },
  }

}

function createDefaultBuildBorrowXdr(
  config: SorobanAdapterConfig
): BuildBorrowXdr {
  return async ({ contractProof, fee, intent }, signal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    // Dynamic-import keeps stellar-sdk out of the initial chunk. Bindings
    // module re-exports the Client class + typed args.
    const bindings = await import("./bindings/borrow-pool")
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const client = new bindings.Client({
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.sorobanRpcUrl,
      publicKey: intent.account,
    })

    const assembled = await client.borrow(
      {
        intent: appToBindingIntent(intent),
        proof: appToBindingProof(contractProof),
      },
      { fee: fee.toString(), timeoutInSeconds: 120 }
    )

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    return assembled.toXDR()
  }
}

type BindingBorrowIntent = {
  account: string
  borrow_amount: bigint
  borrow_symbol: string
  collateral_amount: bigint
  collateral_symbol: string
  expires_at: bigint
  health_factor_bps: number
  market: string
  max_ltv_bps: number
  proof_id: Buffer
}

type BindingBorrowProof = {
  oracle_epoch: bigint
  oracle_price_commitment: Buffer
  proof_bytes: Buffer
}

function appToBindingIntent(intent: BorrowIntent): BindingBorrowIntent {
  return {
    account: intent.account,
    borrow_amount: toStroopsBigInt(intent.borrow.amount),
    borrow_symbol: intent.borrow.symbol,
    collateral_amount: toStroopsBigInt(intent.collateral.amount),
    collateral_symbol: intent.collateral.symbol,
    expires_at: BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000)),
    health_factor_bps: healthFactorToBps(intent.healthFactor),
    market: intent.market,
    max_ltv_bps: Math.round(intent.maxLtv * 10_000),
    proof_id: Buffer.from(proofIdToBytes(intent.proofId)),
  }
}

function appToBindingProof(
  contractProof: BorrowContractPayload
): BindingBorrowProof {
  return {
    oracle_epoch: BigInt(contractProof.oracleEpoch),
    oracle_price_commitment: Buffer.from(contractProof.oraclePriceCommitment),
    proof_bytes: Buffer.from(contractProof.proofBytes),
  }
}

function toStroopsBigInt(amount: number): bigint {
  return BigInt(Math.round(amount * 10_000_000))
}

function healthFactorToBps(healthFactor: number | null): number {
  if (healthFactor === null) return 0
  return Math.max(0, Math.round(healthFactor * 10_000))
}

function proofIdToBytes(proofId: string): Uint8Array {
  // Stable ids from createStableId are short base36-ish strings, not hex.
  // Fold into 32 bytes so the value fits BytesN<32>. ponytail: replace
  // with a real hash once the noir prover produces canonical proof ids.
  const encoder = new TextEncoder()
  const bytes = encoder.encode(proofId)
  const digest = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    digest[index % 32] ^= bytes[index]
  }
  return digest
}

function abortedResult<T>(): AdapterResult<T> {
  return err({ tag: "Aborted", message: "Operation aborted." })
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"))
    }

    if (signal.aborted) {
      onAbort()
      return
    }

    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }

    if (signal?.aborted) {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function mapNetworkError(
  cause: unknown,
  phase: "simulate" | "submit" | "confirm"
): AdapterError {
  const message =
    cause instanceof Error ? cause.message : "Soroban RPC call failed."

  if (
    cause instanceof DOMException &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  ) {
    return { tag: "Aborted", message: "Operation aborted." }
  }

  return { tag: "Network", retriable: true, message: `${phase}: ${message}` }
}

function extractSendErrorCode(response: {
  errorResult?: unknown
  errorResultXdr?: string
}): string {
  if (typeof response.errorResultXdr === "string") return response.errorResultXdr
  if (
    response.errorResult &&
    typeof response.errorResult === "object" &&
    "result" in response.errorResult
  ) {
    return String((response.errorResult as { result: unknown }).result)
  }
  return "unknown"
}

function buildBorrowIntent({
  account,
  borrow,
  collateral,
  expiresAt,
  healthFactor,
  market,
  maxLtv,
  proofId,
}: CreateBorrowIntentParams): BorrowIntent {
  return {
    account,
    borrow,
    collateral,
    expiresAt,
    healthFactor,
    id: createStableId(
      "intent",
      account,
      market,
      proofId,
      borrow.symbol,
      borrow.amount,
      collateral.symbol,
      collateral.amount
    ),
    market,
    maxLtv,
    proofId,
  }
}
