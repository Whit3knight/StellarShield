import type { AssetAmount } from "@/features/shared/asset-amount"
import type { BorrowContractPayload } from "@/features/proofs"

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
  hash?: string
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
  /**
   * Groth16 proof bytes + oracle bindings. The contract's `borrow`
   * function verifies the proof atomically.
   */
  contractProof?: BorrowContractPayload
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

export type ReadChainPositionParams = {
  account: string
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
  /**
   * Read the on-chain position for `account`. Returns `null` when the
   * contract stores no position for the caller.
   */
  readChainPosition?: (
    params: ReadChainPositionParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<ChainBorrowReceipt | null>>
}
