export type MarketStep =
  "detail" | "collateral" | "verification" | "transaction"

export type VerificationStatus = "Not started" | "Checking" | "Verified"

export type TransactionStatus = "Draft" | "Submitted" | "Confirmed"

export type LoanHealth = "Healthy" | "Attention" | "At risk"

export type BorrowField = "collateralAmount" | "loanAmount"

export type BorrowFlowState = {
  collateralAmount: string
  loanAmount: string
  transactionStatus: TransactionStatus
  verificationStatus: VerificationStatus
}

export type BorrowFlowMetrics = {
  borrowingPower: number
  collateralValue: number
  isLoanValid: boolean
  loanHealth: LoanHealth
  loanValue: number
  utilization: number
}
