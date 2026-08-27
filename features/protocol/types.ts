import type { AssetAmount } from "@/features/shared/asset-amount"

export type ProtocolNetwork = "stellar-testnet"

export type ProtocolOperation = "borrow"

export type ProtocolSubmitStatus =
  "Ready" | "Signing" | "Submitted" | "Confirmed" | "Failed"

export type BorrowIntent = {
  account: string
  borrow: AssetAmount
  collateral: AssetAmount
  expiresAt: string
  healthFactor: number | null
  id: string
  market: string
  maxLtv: number
  proofId: string
}

export type ProtocolTransactionPayload = {
  expiresAt: string
  fee: AssetAmount
  hash?: string
  id: string
  intentId: string
  memo: string
  network: ProtocolNetwork
  operation: ProtocolOperation
  preparedXdr?: string
  status: ProtocolSubmitStatus
}

export type ProtocolTransactionReceipt = {
  confirmedAt: string
  hash: string
  network: ProtocolNetwork
}

/**
 * On-chain borrow receipt shape as returned by the borrow-pool
 * `position(account)` view. Phase-1 privacy: raw amounts moved into
 * the circuit as private witness — chain only carries the market +
 * symbols + timestamps.
 */
export type ChainBorrowReceipt = {
  account: string
  borrowSymbol: string
  collateralSymbol: string
  confirmedAt: number
  market: string
  proofId: string
}
