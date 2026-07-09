import type { AssetAmount } from "@/features/shared/asset-amount"

export type ProtocolNetwork = "stellar-testnet"

export type ProtocolOperation = "borrow"

export type ProtocolSimulationStatus =
  "Idle" | "Simulating" | "Ready" | "Failed"

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
  id: string
  intentId: string
  memo: string
  network: ProtocolNetwork
  operation: ProtocolOperation
  status: ProtocolSubmitStatus
}

export type ProtocolSimulationResult = {
  error: string | null
  payload: ProtocolTransactionPayload | null
  status: ProtocolSimulationStatus
}

export type ProtocolTransactionReceipt = {
  confirmedAt: string
  hash: string
  network: ProtocolNetwork
}

export type CreateBorrowIntentParams = Omit<BorrowIntent, "id">

export type PrepareTransactionParams = {
  fee: AssetAmount
  intent: BorrowIntent
  now?: number
}

export type SimulateBorrowParams = {
  fee: AssetAmount
  intent: BorrowIntent | null
  now?: number
}

export type SubmitTransactionParams = {
  payload: ProtocolTransactionPayload | null
}

export type RefreshTransactionParams = {
  payload: ProtocolTransactionPayload | null
  now?: number
}

export type ProtocolSubmitResult = {
  error: string | null
  payload: ProtocolTransactionPayload | null
  receipt: ProtocolTransactionReceipt | null
  status: ProtocolSubmitStatus
}

export type ProtocolAdapter = {
  createBorrowIntent: (params: CreateBorrowIntentParams) => BorrowIntent
  prepareTransaction: (
    params: PrepareTransactionParams
  ) => ProtocolTransactionPayload
  refreshTransaction: (params: RefreshTransactionParams) => ProtocolSubmitResult
  simulateBorrow: (params: SimulateBorrowParams) => ProtocolSimulationResult
  submitTransaction: (params: SubmitTransactionParams) => ProtocolSubmitResult
}
