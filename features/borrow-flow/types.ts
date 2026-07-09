import type {
  BorrowIntent,
  ProtocolTransactionReceipt,
  ProtocolSimulationStatus,
  ProtocolSubmitStatus,
  ProtocolTransactionPayload,
} from "@/features/protocol"
import type { BorrowEligibilityProof } from "@/features/proofs"
import type { AssetAmount } from "@/features/shared/asset-amount"

export type { AssetAmount } from "@/features/shared/asset-amount"

export type MarketStep =
  "detail" | "collateral" | "verification" | "transaction"

export type VerificationStatus =
  | "Not started"
  | "Preparing"
  | "Generating proof"
  | "Verified"
  | "Expired"
  | "Failed"

export type Verification =
  | { status: "Not started" }
  | { status: "Preparing" }
  | { status: "Generating proof" }
  | { status: "Verified"; proof: BorrowProof }
  | { status: "Failed"; proof: BorrowProof }
  | { status: "Expired"; proof: BorrowProof }

export type TransactionStatus = "Draft" | ProtocolSubmitStatus

export type LoanHealth = "Healthy" | "Attention" | "At risk"

export type BorrowField = "collateralAmount" | "loanAmount"

export type UserPosition = {
  borrowed: AssetAmount[]
  borrowApr: string
  borrowingPowerUsed: number
  id: string
  healthFactor: number | null
  market: string
  nextPaymentDue: string
  openedAt: string
  receiptHash: string
  status: "Open"
  supplied: AssetAmount[]
}

export type BorrowActivityType =
  | "borrow_intent_prepared"
  | "proof_generated"
  | "transaction_confirmed"
  | "transaction_submitted"
  | "wallet_connected"

export type BorrowActivityStatus = "completed" | "failed" | "pending"

export type BorrowActivity = {
  description: string
  id: string
  privateValue?: boolean
  status: BorrowActivityStatus
  timestamp: string
  title: string
  type: BorrowActivityType
  value?: string
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

export type BorrowProof = BorrowEligibilityProof

export type BorrowFlowState = {
  borrowIntent: BorrowIntent | null
  collateralAmount: string
  loanAmount: string
  simulationStatus: ProtocolSimulationStatus
  transactionPayload: ProtocolTransactionPayload | null
  transactionReceipt: ProtocolTransactionReceipt | null
  transactionStatus: TransactionStatus
  verification: Verification
}

export const NO_VERIFICATION: Verification = { status: "Not started" }

export function getProof(verification: Verification): BorrowProof | null {
  return "proof" in verification ? verification.proof : null
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
