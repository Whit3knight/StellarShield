import { Buffer } from "buffer"

import type { BorrowContractPayload } from "@/features/proofs"
import { createStableId } from "@/lib/stable-id"

const assemblyCache = new Map<string, BorrowAssembly>()

import {
  err,
  ok,
  tryParseContractError,
  type AdapterResult,
  type AdapterError,
} from "./result"
import {
  createDefaultSorobanRpcClient,
  type SorobanRpcClient,
} from "./soroban-rpc"
import type {
  BorrowIntent,
  ChainBorrowReceipt,
  CreateBorrowIntentParams,
  ProtocolAdapter,
} from "./types"

export type ReadChainPosition = (
  params: { account: string },
  signal?: AbortSignal
) => Promise<ChainBorrowReceipt | null>

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

export type BorrowAssembly = {
  xdr: string
  signAndSend: (
    signTransaction: (
      xdr: string,
      opts?: {
        networkPassphrase?: string
        address?: string
        submit?: boolean
      }
    ) => Promise<{
      signedTxXdr: string
      signerAddress?: string
      error?: { message: string; code: number }
    }>
  ) => Promise<{ hash: string }>
}

export type BuildBorrowXdr = (
  input: BuildBorrowXdrInput,
  signal?: AbortSignal
) => Promise<BorrowAssembly>

export type SorobanAdapterDeps = {
  buildBorrowXdr?: BuildBorrowXdr
  readChainPosition?: ReadChainPosition
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
  const readChainPositionImpl =
    deps.readChainPosition ?? createDefaultReadChainPosition(config)
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

      let assembly: BorrowAssembly
      try {
        assembly = await buildBorrowXdr(
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
      const payloadId = createStableId(
        "payload",
        params.intent.id,
        params.intent.account,
        params.intent.borrow.symbol,
        params.intent.borrow.amount,
        nowMs.toString()
      )

      // Cache the AssembledTransaction closure so signTransaction +
      // submitTransaction can drive `assembled.signAndSend()` end to end.
      // Envelope XDR alone doesn't survive Freighter's re-signing of a
      // Soroban invokeHostFunction op — the SDK's signAndSend handles
      // auth entries + resource extension correctly.
      assemblyCache.set(payloadId, assembly)

      return ok({
        expiresAt: params.intent.expiresAt,
        fee: params.fee,
        id: payloadId,
        intentId: params.intent.id,
        memo: "Stellar Shield borrow",
        network: "stellar-testnet",
        operation: "borrow",
        preparedXdr: assembly.xdr,
        status: "Ready",
      })
    },
    signTransaction: async ({ account, payload }, signal) => {
      if (signal?.aborted) return abortedResult()

      const assembly = assemblyCache.get(payload.id)
      if (!assembly) {
        return err({
          tag: "InvalidInput",
          field: "payload.id",
          message:
            "signTransaction: no cached AssembledTransaction for this payload. Re-run simulateBorrow.",
        })
      }

      // Drive sign + send atomically via the bindings' AssembledTransaction.
      // Freighter's signTransaction callback matches the SDK's signature
      // so we plug it straight in.
      try {
        const { signTransaction: freighter } = await import(
          "@stellar/freighter-api"
        )

        const sent = await assembly.signAndSend(async (xdrToSign, opts) => {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
          return freighter(xdrToSign, {
            address: opts?.address ?? account,
            networkPassphrase:
              opts?.networkPassphrase ?? config.networkPassphrase,
          })
        })

        if (signal?.aborted) return abortedResult()

        return ok({
          payload: { ...payload, hash: sent.hash, status: "Signing" },
          signedXdr: sent.hash,
        })
      } catch (cause) {
        if (signal?.aborted) return abortedResult()
        return err(mapNetworkError(cause, "submit"))
      }
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

      // signTransaction already ran assembled.signAndSend which submitted
      // the tx to the network. If signedXdr looks like a plain hash
      // (32-byte hex), skip the raw sendTransaction call and just
      // advance to Submitted.
      if (/^[0-9a-fA-F]{64}$/.test(signedXdr)) {
        return ok({
          ...payload,
          hash: signedXdr,
          status: "Submitted",
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
    readChainPosition: async (params, signal) => {
      if (signal?.aborted) return abortedResult()

      try {
        const value = await readChainPositionImpl(params, signal)
        if (signal?.aborted) return abortedResult()
        return ok(value)
      } catch (cause) {
        if (signal?.aborted) return abortedResult()
        return err(mapNetworkError(cause, "simulate"))
      }
    },
  }

}

function createDefaultReadChainPosition(
  config: SorobanAdapterConfig
): ReadChainPosition {
  return async ({ account }, signal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const bindings = await import("./bindings/borrow-pool")
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const client = new bindings.Client({
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.sorobanRpcUrl,
      publicKey: account,
    })

    const assembled = await client.position({ account })
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const raw = assembled.result as unknown
    if (!raw) return null

    // Bindings return an Option-shaped result. Both { tag: "None" }
    // and null-ish shapes represent "no position for this account".
    const tagged = raw as { tag?: string; value?: unknown }
    const inner =
      typeof raw === "object" && raw !== null && "tag" in raw
        ? tagged.tag === "Some"
          ? tagged.value
          : null
        : raw

    if (!inner || typeof inner !== "object") return null

    const receipt = inner as {
      account: string
      borrow_symbol: string
      collateral_symbol: string
      confirmed_at: bigint | number
      market: string
      proof_id: Buffer | Uint8Array
    }

    return {
      account: receipt.account,
      borrowSymbol: receipt.borrow_symbol,
      collateralSymbol: receipt.collateral_symbol,
      confirmedAt: Number(receipt.confirmed_at),
      market: receipt.market,
      proofId: bytesToHex(receipt.proof_id),
    }
  }
}

function bytesToHex(bytes: Buffer | Uint8Array): string {
  let out = "0x"
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0")
  }
  return out
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

    return {
      xdr: assembled.toXDR(),
      signAndSend: async (signTransaction) => {
        const sent = await assembled.signAndSend({
          signTransaction: signTransaction as unknown as Parameters<
            typeof assembled.signAndSend
          >[0] extends undefined
            ? never
            : NonNullable<
                Parameters<typeof assembled.signAndSend>[0]
              >["signTransaction"],
        })
        return {
          hash: sent.sendTransactionResponse?.hash ?? "",
        }
      },
    }
  }
}

type BindingBorrowIntent = {
  account: string
  borrow_symbol: string
  collateral_symbol: string
  expires_at: bigint
  health_factor_bps: number
  market: string
  max_ltv_bps: number
  proof_id: Buffer
}

type BindingBorrowProof = {
  a: Buffer
  b: Buffer
  c: Buffer
  oracle_epoch: bigint
  public_signals: bigint[]
}

function appToBindingIntent(intent: BorrowIntent): BindingBorrowIntent {
  return {
    account: intent.account,
    borrow_symbol: sanitizeSymbol(intent.borrow.symbol),
    collateral_symbol: sanitizeSymbol(intent.collateral.symbol),
    expires_at: BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000)),
    health_factor_bps: healthFactorToBps(intent.healthFactor),
    market: sanitizeSymbol(intent.market),
    max_ltv_bps: Math.round(intent.maxLtv * 10_000),
    proof_id: Buffer.from(proofIdToBytes(intent.proofId)),
  }
}

/**
 * Soroban `Symbol` allows `[a-zA-Z0-9_]` up to 32 chars. Our app markets
 * are quoted `USDC/XLM` — the slash is illegal and trips ScVal decode.
 * Fold to underscore so it becomes `USDC_XLM`. Contract-side comparison
 * uses the same encoding via the same helper.
 */
function sanitizeSymbol(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32)
}

function appToBindingProof(
  contractProof: BorrowContractPayload
): BindingBorrowProof {
  return {
    a: Buffer.from(contractProof.a),
    b: Buffer.from(contractProof.b),
    c: Buffer.from(contractProof.c),
    oracle_epoch: BigInt(contractProof.oracleEpoch),
    public_signals: contractProof.publicSignals.map(bytes32ToBigInt),
  }
}

function bytes32ToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
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

  const contractError = tryParseContractError(message)
  if (contractError) return contractError

  return { tag: "Network", retriable: true, message: `${phase}: ${message}` }
}

function extractSendErrorCode(response: {
  errorResult?: unknown
  errorResultXdr?: string
  diagnosticEventsXdr?: string[]
}): string {
  if (typeof response.errorResultXdr === "string") return response.errorResultXdr

  // Stellar SDK's TransactionResult XDR object exposes a `.result()`
  // *method* (not property) whose switch().name gives a stable code.
  // Naive String(obj.result) stringified the method itself in older
  // impls — instead call it and dig for a discriminant.
  const errorResult = response.errorResult as
    | {
        result?: () => { switch?: () => { name?: string } }
        toXDR?: (format: "base64") => string
      }
    | undefined

  if (errorResult) {
    try {
      const inner = errorResult.result?.()
      const name = inner?.switch?.().name
      if (typeof name === "string" && name.length > 0) return name
    } catch {
      // fall through
    }
    try {
      const xdr = errorResult.toXDR?.("base64")
      if (typeof xdr === "string" && xdr.length > 0) return xdr
    } catch {
      // fall through
    }
  }

  if (Array.isArray(response.diagnosticEventsXdr) && response.diagnosticEventsXdr.length > 0) {
    return response.diagnosticEventsXdr[0]
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
