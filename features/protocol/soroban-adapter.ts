import { signXdr } from "@/features/wallet/signer"
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

export type SorobanAdapterDeps = {
  rpcClient?: SorobanRpcClient
}

export function createSorobanProtocolAdapter(
  config: SorobanAdapterConfig,
  deps: SorobanAdapterDeps = {}
): ProtocolAdapter {
  const rpcClient =
    deps.rpcClient ?? createDefaultSorobanRpcClient(config.sorobanRpcUrl)
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
            "simulateBorrow requires a contractProof — the Soroban adapter needs the Groth16 proof bytes + oracle bindings to build the borrow tx.",
        })
      }

      return err(
        notImplemented(
          "simulateBorrow",
          "Build a TransactionBuilder with Contract(id).call('borrow', intent, proof) using the passed contractProof, simulate via rpc.Server.simulateTransaction, assemble via rpc.assembleTransaction, and return { ...payload, preparedXdr }."
        )
      )
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

  function notImplemented(method: string, todo: string): AdapterError {
    return {
      tag: "Unknown",
      message: `sorobanProtocolAdapter.${method} not yet wired for contract ${config.contractId}. ${todo}`,
    }
  }
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

function mapNetworkError(cause: unknown, phase: "submit" | "confirm"): AdapterError {
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
