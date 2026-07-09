import { createStableId } from "@/lib/stable-id"

import { err, ok, type AdapterResult, type AdapterError } from "./result"
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

export function createSorobanProtocolAdapter(
  config: SorobanAdapterConfig
): ProtocolAdapter {
  return {
    createBorrowIntent: async (params, signal) => {
      if (signal?.aborted) return abortedResult()

      return ok(buildBorrowIntent(params))
    },
    simulateBorrow: async (_params, signal) => {
      if (signal?.aborted) return abortedResult()

      return err(
        notImplemented(
          "simulateBorrow",
          "Build a TransactionBuilder with Contract(id).call('borrow_preview', ...), simulate via rpc.Server.simulateTransaction, assemble via rpc.assembleTransaction, and return { ...payload, preparedXdr }."
        )
      )
    },
    signTransaction: async (_params, signal) => {
      if (signal?.aborted) return abortedResult()

      return err(
        notImplemented(
          "signTransaction",
          "Delegate to features/wallet/signer.ts (yet to be extracted) with { xdr: payload.preparedXdr, address, networkPassphrase } and map Freighter/WalletConnect user-cancel to UserRejected."
        )
      )
    },
    submitTransaction: async (_params, signal) => {
      if (signal?.aborted) return abortedResult()

      return err(
        notImplemented(
          "submitTransaction",
          "Deserialise signedXdr via TransactionBuilder.fromXDR(signedXdr, networkPassphrase); rpc.Server.sendTransaction; map tx_bad_seq -> refresh sequence + retry once."
        )
      )
    },
    waitForConfirmation: async (_params, signal) => {
      if (signal?.aborted) return abortedResult()

      return err(
        notImplemented(
          "waitForConfirmation",
          "Poll rpc.Server.getTransaction(hash) every 2s until SUCCESS/FAILED/timeout; timeout param from WaitForConfirmationParams.timeoutMs (default 60s)."
        )
      )
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
