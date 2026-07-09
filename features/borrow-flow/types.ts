import type {
  BorrowIntent,
  ProtocolSimulationStatus,
  ProtocolSubmitStatus,
  ProtocolTransactionPayload,
} from "@/features/protocol"
import type { SupportedAssetSymbol } from "@/features/markets"

export type MarketStep =
  "detail" | "collateral" | "verification" | "transaction"

export type VerificationStatus =
  | "Not started"
  | "Preparing"
  | "Generating proof"
  | "Verified"
  | "Expired"
  | "Failed"

export type TransactionStatus = "Draft" | ProtocolSubmitStatus

export type LoanHealth = "Healthy" | "Attention" | "At risk"

export type BorrowField = "collateralAmount" | "loanAmount"

export type AssetAmount = {
  amount: number
  symbol: SupportedAssetSymbol
  valueUsd: number
}

export type UserPosition = {
  borrowed: AssetAmount[]
  borrowingPowerUsed: number
  healthFactor: number | null
  supplied: AssetAmount[]
}

export type BorrowQuote = {
  borrowingPower: number
  collateral: AssetAmount
  collateralWalletBalance: number
  estimatedFee: AssetAmount
  healthFactor: number | null
  liquidationPrice: number | null
  loan: AssetAmount
  loanHealth: LoanHealth
  maxLoanAmount: number
  market: string
  utilization: number
  validationError: string | null
}

export type TransactionPreview = {
  account: string
  borrowApr: string
  collateral: string
  collateralValue: string
  estimatedFee: string
  healthFactor: string
  intentId: string
  loan: string
  loanHealth: LoanHealth
  loanValue: string
  market: string
  memo: string
  network: string
  operation: string
  proof: string
  receipt: string | null
  simulation: ProtocolSimulationStatus
  status: TransactionStatus
  verification: VerificationStatus
}

export type BorrowProof = {
  claim: string
  expiresAt: string
  id: string
  publicInputs: {
    healthFactorMin: string
    market: string
    maxLtv: string
  }
  status: VerificationStatus
}

export type BorrowFlowState = {
  borrowIntent: BorrowIntent | null
  collateralAmount: string
  loanAmount: string
  proof: BorrowProof | null
  simulationStatus: ProtocolSimulationStatus
  transactionPayload: ProtocolTransactionPayload | null
  transactionStatus: TransactionStatus
  verificationStatus: VerificationStatus
}

export type BorrowFlowMetrics = {
  borrowingPower: number
  collateralAmount: number
  collateralValue: number
  collateralWalletBalance: number
  hasWallet: boolean
  healthFactor: number | null
  isLoanValid: boolean
  liquidationPrice: number | null
  loanHealth: LoanHealth
  loanAmount: number
  loanValue: number
  maxLoanAmount: number
  quote: BorrowQuote
  validationError: string | null
  utilization: number
}
