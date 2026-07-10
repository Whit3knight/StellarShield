import type {
  AdapterError,
  BorrowIntent,
  ProtocolTransactionPayload,
  ProtocolTransactionReceipt,
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
  | { status: "Failed"; proof: BorrowProof | null; error?: AdapterError }
  | { status: "Expired"; proof: BorrowProof }

export type TransactionStatus =
  | "Draft"
  | "Ready"
  | "Signing"
  | "Submitted"
  | "Confirmed"
  | "Failed"

export type Transaction =
  | { status: "Draft" }
  | {
      status: "Ready"
      intent: BorrowIntent
      payload: ProtocolTransactionPayload
    }
  | {
      status: "Signing"
      intent: BorrowIntent
      payload: ProtocolTransactionPayload
    }
  | {
      status: "Submitted"
      intent: BorrowIntent
      payload: ProtocolTransactionPayload
    }
  | {
      status: "Confirmed"
      intent: BorrowIntent
      payload: ProtocolTransactionPayload
      receipt: ProtocolTransactionReceipt
    }
  | {
      status: "Failed"
      intent?: BorrowIntent
      payload?: ProtocolTransactionPayload
      error?: AdapterError
    }

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
  error: string | null
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
  status: TransactionStatus
  verification: VerificationStatus
}

export type BorrowProof = BorrowEligibilityProof

export type BorrowFlowState = {
  collateralAmount: string
  loanAmount: string
  transaction: Transaction
  verification: Verification
}

export const NO_VERIFICATION: Verification = { status: "Not started" }
export const NO_TRANSACTION: Transaction = { status: "Draft" }

export function getProof(verification: Verification): BorrowProof | null {
  return "proof" in verification ? verification.proof : null
}

export function getIntent(transaction: Transaction): BorrowIntent | null {
  return "intent" in transaction ? transaction.intent ?? null : null
}

export function getPayload(
  transaction: Transaction
): ProtocolTransactionPayload | null {
  return "payload" in transaction ? transaction.payload ?? null : null
}

export function getReceipt(
  transaction: Transaction
): ProtocolTransactionReceipt | null {
  return transaction.status === "Confirmed" ? transaction.receipt : null
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
