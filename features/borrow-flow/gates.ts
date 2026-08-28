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
 * cycle. R28: reads `availableBalance` (the reserve SAC's real balance
 * for this asset — see `market-stats.ts`), not
 * `totalDepositsValue - totalBorrowsValue`. `total_borrow_value` is
 * only ever decremented on-chain, never incremented (`borrow_amount`
 * has been a private witness since R20), so that subtraction always
 * reduced to just `totalDepositsValue` and never reflected outstanding
 * loans — this gate would pass even when a market was fully drained.
 * Compares against `DENOMINATION` as a "meaningfully more than zero"
 * floor, same as before.
 */
export function hasBorrowLiquidity(
  stat: MarketStat | undefined,
  asset: ShieldedAsset
): boolean {
  if (!stat) return true // no snapshot yet — don't block on missing data
  return stat.availableBalance >= DENOMINATION[asset]
}
