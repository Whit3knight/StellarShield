// Shared underwater-check formula for shielded liquidation (R22).
//
// `collateralNotional` is committed at borrow time as
// `rawCollateral * borrowPrice`, so it carries one factor of
// `PRICE_RATIO_SCALE` (1e14) that `loanAmount` doesn't. Comparing them
// directly (as this project's circuits and every TS copy of this check
// did before R22) is off by ~1e14x — see docs/REMEDIATION.md R22.
//
// This is the ONE place this formula lives — liquidate-prover.ts,
// liquidate-v2-prover.ts, and scan-underwater.ts all import it instead
// of carrying their own inline copy, which is exactly how this bug
// survived three separate fix opportunities before R22.

import { PRICE_RATIO_SCALE } from "@/features/markets/prices"

export type UnderwaterInputs = {
  loanAmount: bigint
  collateralNotional: bigint
  borrowPrice: bigint
  currentPrice: bigint
  thresholdBps: number
}

/**
 * Today's real collateral value in loan-asset units, descaled from
 * `collateralNotional`'s open-time price basis.
 */
export function collateralNow({
  collateralNotional,
  borrowPrice,
  currentPrice,
}: Pick<UnderwaterInputs, "collateralNotional" | "borrowPrice" | "currentPrice">): bigint {
  return (collateralNotional * currentPrice) / (borrowPrice * PRICE_RATIO_SCALE)
}

/**
 * Underwater when `collateralNow * thresholdBps < loanAmount * 10000` —
 * matches `components/organisms/loan-health.ts`'s convention exactly
 * (thresholdBps as a max-LTV ceiling on loan/collateral, not a floor on
 * collateral/loan).
 */
export function isUnderwater(inputs: UnderwaterInputs): boolean {
  return (
    collateralNow(inputs) * BigInt(inputs.thresholdBps) <
    inputs.loanAmount * 10_000n
  )
}
