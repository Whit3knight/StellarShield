import { createStableId } from "@/lib/stable-id"

import { err, ok, type AdapterResult } from "./result"
import type {
  BorrowIntent,
  CreateBorrowIntentParams,
  PrepareTransactionParams,
  ProtocolAdapter,
  ProtocolTransactionPayload,
  ProtocolTransactionReceipt,
  SignedTransaction,
  SimulateBorrowParams,
} from "./types"

const PROTOCOL_NETWORK = "stellar-testnet"
const TRANSACTION_TTL_MS = 5 * 60 * 1000
const MOCK_TRANSACTION_HASH = "3f6d...91b2"

export const mockProtocolAdapter: ProtocolAdapter = {
  createBorrowIntent: async (params, signal) => {
    if (signal?.aborted) return abortedResult()

    return ok(makeBorrowIntent(params))
  },
  simulateBorrow: async (params, signal) => {
    if (signal?.aborted) return abortedResult()

    return ok(makeTransactionPayload(params))
  },
  signTransaction: async ({ payload }, signal) => {
    if (signal?.aborted) return abortedResult()

    const signedPayload: ProtocolTransactionPayload = {
      ...payload,
      status: "Signing",
    }
    const signed: SignedTransaction = {
      payload: signedPayload,
      signedXdr: `signed:${payload.id}`,
    }

    return ok(signed)
  },
  submitTransaction: async ({ payload }, signal) => {
    if (signal?.aborted) return abortedResult()

    return ok({ ...payload, status: "Submitted" })
  },
  waitForConfirmation: async ({ payload, now = Date.now() }, signal) => {
    if (signal?.aborted) return abortedResult()

    const receipt: ProtocolTransactionReceipt = {
      confirmedAt: new Date(now).toISOString(),
      hash: MOCK_TRANSACTION_HASH,
      network: payload.network,
    }

    return ok(receipt)
  },
}

export function makeBorrowIntent({
  account,
  borrow,
  collateral,
  expiresAt,
  healthFactor,
  market,
  maxLtv,
  proofId,
}: CreateBorrowIntentParams): BorrowIntent {
  const id = createStableId(
    "intent",
    account,
    market,
    proofId,
    borrow.symbol,
    borrow.amount,
    collateral.symbol,
    collateral.amount
  )

  return {
    account,
    borrow,
    collateral,
    expiresAt,
    healthFactor,
    id,
    market,
    maxLtv,
    proofId,
  }
}

export function makeTransactionPayload({
  fee,
  intent,
  now = Date.now(),
}: PrepareTransactionParams | SimulateBorrowParams): ProtocolTransactionPayload {
  const id = createStableId("tx", intent.id, fee.symbol, fee.amount)

  return {
    expiresAt: new Date(now + TRANSACTION_TTL_MS).toISOString(),
    fee,
    id,
    intentId: intent.id,
    memo: `StellarShield borrow ${intent.market}`,
    network: PROTOCOL_NETWORK,
    operation: "borrow",
    status: "Ready",
  }
}

function abortedResult<T>(): AdapterResult<T> {
  return err({ tag: "Aborted", message: "Operation aborted." })
}

