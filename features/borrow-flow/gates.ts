import type { MarketStat } from "@/features/markets"
import { DENOMINATION, type ShieldedAsset } from "@/features/notes"

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

/**
 * Whether the borrow asset's pool has at least one denomination's
 * worth of real value as headroom before a user burns ~10-30s
 * generating a borrow proof. Advisory only: `stat` can be up to 60s
 * stale (`useMarketStats`) and this is not a substitute for a
 * contract-side reservation check — it just moves the common "proof
 * succeeds, Claim fails later" case earlier than a wasted proving
 * cycle. R17: compares real value counters against `DENOMINATION` as
 * a "meaningfully more than zero" floor — comparing against a bare
 * `>= 1` (raw stroop) would make this check pass almost always once
 * `totalDeposits`/`totalBorrows` mean value instead of note counts.
 */
export function hasBorrowLiquidity(
  stat: MarketStat | undefined,
  asset: ShieldedAsset
): boolean {
  if (!stat) return true // no snapshot yet — don't block on missing data
  return stat.totalDepositsValue - stat.totalBorrowsValue >= DENOMINATION[asset]
}
