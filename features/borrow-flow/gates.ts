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

/**
 * Whether the transaction step should stay visible. `canSubmitTransaction`
 * flips false the instant Submit sets the tx to Signing — using it alone
 * to mount the transaction UI unmounts the step mid-submit and dumps the
 * user back on verification. Once the transaction has left Draft it must
 * stay pinned (the desktop drawer's pin effect encodes the same rule).
 */
export function shouldShowTransaction({
  metrics,
  status,
  transaction,
}: {
  metrics: BorrowFlowMetrics
  status: VerificationStatus
  transaction: Transaction
}): boolean {
  return (
    canSubmitTransaction({ metrics, status, transaction }) ||
    transaction.status === "Signing" ||
    transaction.status === "Submitted" ||
    transaction.status === "Confirmed" ||
    transaction.status === "Failed"
  )
}
