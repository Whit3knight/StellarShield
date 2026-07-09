import type { AssetAmount } from "@/features/shared/asset-amount"

import type { AdapterResult } from "./result"

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
  preparedXdr?: string
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
  intent: BorrowIntent
  now?: number
}

export type SignTransactionParams = {
  account: string
  payload: ProtocolTransactionPayload
}

export type SignedTransaction = {
  payload: ProtocolTransactionPayload
  signedXdr: string
}

export type SubmitTransactionParams = {
  payload: ProtocolTransactionPayload
  signedXdr: string
}

export type WaitForConfirmationParams = {
  payload: ProtocolTransactionPayload
  now?: number
  timeoutMs?: number
}

export type ProtocolAdapter = {
  createBorrowIntent: (
    params: CreateBorrowIntentParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<BorrowIntent>>
  simulateBorrow: (
    params: SimulateBorrowParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<ProtocolTransactionPayload>>
  signTransaction: (
    params: SignTransactionParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<SignedTransaction>>
  submitTransaction: (
    params: SubmitTransactionParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<ProtocolTransactionPayload>>
  waitForConfirmation: (
    params: WaitForConfirmationParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<ProtocolTransactionReceipt>>
}
