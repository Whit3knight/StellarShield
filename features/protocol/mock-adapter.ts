import type {
  BorrowIntent,
  ProtocolAssetAmount,
  ProtocolSimulationResult,
  ProtocolSubmitStatus,
  ProtocolTransactionPayload,
} from "./types"

const PROTOCOL_NETWORK = "stellar-testnet"
const TRANSACTION_TTL_MS = 5 * 60 * 1000

export function createBorrowIntent({
  account,
  borrow,
  collateral,
  expiresAt,
  healthFactor,
  market,
  maxLtv,
  proofId,
}: Omit<BorrowIntent, "id">): BorrowIntent {
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
}: {
  fee: ProtocolAssetAmount
  intent: BorrowIntent | null
  now?: number
}): ProtocolSimulationResult {
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
  now,
}: {
  fee: ProtocolAssetAmount
  intent: BorrowIntent
  now: number
}): ProtocolTransactionPayload {
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

function createStableId(
  prefix: string,
  ...parts: Array<number | string>
): string {
  const input = parts.join("|")
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }

  return `${prefix}-${hash.toString(36).padStart(7, "0")}`
}
