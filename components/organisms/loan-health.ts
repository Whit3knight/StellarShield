import { PRICE_RATIO_SCALE } from "@/features/markets/prices"
import type { ShieldedAsset, ShieldedNote } from "@/features/notes"

export type LoanHealth = {
  /** Current collateral value over debt, in whole percent. */
  hfPercent: number
  /** Debt has crossed the liquidation threshold at the current price. */
  atRisk: boolean
}

/**
 * Health of one shielded loan against the live oracle.
 *
 * The bond pins the collateral in LOAN-asset units at open time:
 * `borrowPrice` is `fetchPriceRatio(collateralAsset, loanAsset)` — one
 * RAW collateral unit in RAW loan units, `PRICE_RATIO_SCALE`-scaled —
 * and `collateralValue` is `rawCollateral × borrowPrice`. So the
 * current reading has to be that same ratio at that same scale, and
 * the product has to be divided back down by `PRICE_RATIO_SCALE`:
 *
 *   collateralNow = collateralValue × ratioNow / (borrowPrice × 1e14)
 *   hfPercent     = collateralNow × 100 / loanAmount
 *
 * Returns `null` when the reading cannot be made honestly — a missing
 * or non-positive price, a bond with no open price, a zero loan. Money
 * path: callers render nothing rather than a confident wrong number.
 */
export function loanHealth({
  bond,
  loanAmount,
  loanAsset,
  prices,
  thresholdBps,
}: {
  bond: NonNullable<ShieldedNote["bond"]>
  loanAmount: bigint
  loanAsset: ShieldedAsset
  prices: Record<ShieldedAsset, number>
  thresholdBps: number
}): LoanHealth | null {
  // Legacy loans predate the memoised collateral asset; falling back
  // to the loan asset is only correct when they are the same asset,
  // which is exactly when the ratio is parity either way.
  const collateralAsset = bond.collateralAsset ?? loanAsset
  const collateralPrice = prices[collateralAsset]
  const loanPrice = prices[loanAsset]
  if (!(collateralPrice > 0) || !(loanPrice > 0)) return null
  if (bond.borrowPrice <= 0n || bond.collateralValue <= 0n) return null
  if (loanAmount <= 0n) return null

  // ponytail: the token-decimal factor `fetchPriceRatio` carries is
  // exactly 1 while all three SACs are 7 decimals, so USD floats are
  // enough to rebuild the ratio here. Add a 6-decimal asset and this
  // has to read `assets[x].decimals` like `prices.ts` does.
  const scaled = Math.round((collateralPrice / loanPrice) * Number(PRICE_RATIO_SCALE))
  if (!Number.isFinite(scaled) || scaled <= 0) return null
  const ratioNow = BigInt(scaled)

  const hfPercent = Number(
    (bond.collateralValue * ratioNow * 100n) /
      (bond.borrowPrice * PRICE_RATIO_SCALE * loanAmount)
  )

  // `thresholdBps` is a max LTV: liquidatable once debt/collateral
  // passes it, i.e. once collateral/debt falls under 10000/thresholdBps.
  return { atRisk: hfPercent * thresholdBps < 10_000 * 100, hfPercent }
}
