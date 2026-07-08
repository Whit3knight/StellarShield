export type MarketStep =
  "detail" | "collateral" | "verification" | "transaction"

export type VerificationStatus =
  | "Not started"
  | "Preparing"
  | "Generating proof"
  | "Verified"
  | "Expired"
  | "Failed"

export type TransactionStatus = "Draft" | "Submitted" | "Confirmed"

export type LoanHealth = "Healthy" | "Attention" | "At risk"

export type BorrowField = "collateralAmount" | "loanAmount"

export type AssetAmount = {
  amount: number
  symbol: string
  valueUsd: number
}

export type UserPosition = {
  borrowed: AssetAmount[]
  borrowingPowerUsed: number
  healthFactor: number | null
  supplied: AssetAmount[]
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
  collateralAmount: string
  loanAmount: string
  proof: BorrowProof | null
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
  validationError: string | null
  utilization: number
}
