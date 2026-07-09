import type { SupportedAssetSymbol } from "@/features/markets"

export type ProtocolNetwork = "stellar-testnet"

export type ProtocolOperation = "borrow"

export type ProtocolSimulationStatus =
  "Idle" | "Simulating" | "Ready" | "Failed"

export type ProtocolSubmitStatus =
  "Ready" | "Signing" | "Submitted" | "Confirmed" | "Failed"

export type ProtocolAssetAmount = {
  amount: number
  symbol: SupportedAssetSymbol
  valueUsd: number
}

export type BorrowIntent = {
  account: string
  borrow: ProtocolAssetAmount
  collateral: ProtocolAssetAmount
  expiresAt: string
  healthFactor: number | null
  id: string
  market: string
  maxLtv: number
  proofId: string
}

export type ProtocolTransactionPayload = {
  expiresAt: string
  fee: ProtocolAssetAmount
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
