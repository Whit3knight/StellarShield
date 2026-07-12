import type {
  BorrowFlowMetrics,
  Transaction,
  VerificationStatus,
} from "./types"

/**
 * Whether the "Submit transaction" button should be enabled. The gate
 * fires only when the shielded eligibility proof came back Verified,
 * the metrics quote still validates the loan amount, and the
 * transaction step already prepared its intent + payload.
 */
export function canSubmitTransaction({
  metrics,
  status,
  transaction,
}: {
  metrics: BorrowFlowMetrics
  status: VerificationStatus
  transaction: Transaction
}): boolean {
  return (
    status === "Verified" &&
    metrics.isLoanValid &&
    transaction.status === "Ready"
  )
}
