import { createStableId } from "@/lib/stable-id"

import type {
  BorrowIntent,
  CreateBorrowIntentParams,
  PrepareTransactionParams,
  ProtocolAdapter,
  ProtocolSubmitResult,
  ProtocolSimulationResult,
  ProtocolSubmitStatus,
  ProtocolTransactionPayload,
  RefreshTransactionParams,
  SimulateBorrowParams,
  SubmitTransactionParams,
} from "./types"

const PROTOCOL_NETWORK = "stellar-testnet"
const TRANSACTION_TTL_MS = 5 * 60 * 1000
const MOCK_TRANSACTION_HASH = "3f6d...91b2"

export const mockProtocolAdapter: ProtocolAdapter = {
  createBorrowIntent,
  prepareTransaction: createTransactionPayload,
  refreshTransaction,
  simulateBorrow: simulateBorrowIntent,
  submitTransaction,
}

export function createBorrowIntent({
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

export function simulateBorrowIntent({
  fee,
  intent,
  now = Date.now(),
}: SimulateBorrowParams): ProtocolSimulationResult {
  if (!intent) {
    return {
      error: "Borrow intent is required before simulation.",
      payload: null,
      status: "Failed",
    }
  }

  return {
    error: null,
    payload: createTransactionPayload({ fee, intent, now }),
    status: "Ready",
  }
}

export function submitTransaction({
  payload,
}: SubmitTransactionParams): ProtocolSubmitResult {
  if (!payload) {
    return {
      error: "Transaction payload is required before submission.",
      payload: null,
      receipt: null,
      status: "Failed",
    }
  }

  return {
    error: null,
    payload: {
      ...payload,
      status: "Signing",
    },
    receipt: null,
    status: "Signing",
  }
}

export function refreshTransaction({
  payload,
  now = Date.now(),
}: RefreshTransactionParams): ProtocolSubmitResult {
  if (!payload) {
    return {
      error: "Transaction payload is required before refresh.",
      payload: null,
      receipt: null,
      status: "Failed",
    }
  }

  const status = getNextSubmitStatus(payload.status)
  const nextPayload = {
    ...payload,
    status,
  }

  return {
    error: null,
    payload: nextPayload,
    receipt:
      status === "Confirmed"
        ? {
            confirmedAt: new Date(now).toISOString(),
            hash: MOCK_TRANSACTION_HASH,
            network: payload.network,
          }
        : null,
    status,
  }
}

export function getNextSubmitStatus(
  status: ProtocolSubmitStatus
): ProtocolSubmitStatus {
  if (status === "Signing") {
    return "Submitted"
  }

  if (status === "Submitted") {
    return "Confirmed"
  }

  return status
}

function createTransactionPayload({
  fee,
  intent,
  now = Date.now(),
}: PrepareTransactionParams): ProtocolTransactionPayload {
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

