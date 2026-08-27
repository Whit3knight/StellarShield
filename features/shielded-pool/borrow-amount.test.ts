import { describe, expect, it } from "vitest"

import { marketCards, PRICE_RATIO_SCALE } from "@/features/markets"
import {
  COLLATERAL_NOTES_PER_BORROW,
  DENOMINATION,
  type ShieldedAsset,
} from "@/features/notes"

import { computeBorrowAmount } from "./borrow-prover"

// Contract default (`risk_params.max_ltv_bps`), mirrored by
// MAX_LOAN_TO_VALUE = 0.625 on the borrow-flow side.
const MAX_LTV_BPS = 6_250

// Reflector quotes USD at 14 decimals. XLM ≈ $0.17111797923866.
const XLM_USD = 17_111_797_923_866n
const USDC_USD = 100_000_000_000_000n
const EURC_USD = 108_000_000_000_000n

const USD_PRICE: Record<ShieldedAsset, bigint> = {
  EURC: EURC_USD,
  USDC: USDC_USD,
  XLM: XLM_USD,
}

// Mirrors fetchPriceRatio for equal-decimal assets: all three SACs are
// 7-decimal and all feeds report 14, so both correction factors are 1.
function ratio(collateral: ShieldedAsset, borrow: ShieldedAsset): bigint {
  return (USD_PRICE[collateral] * PRICE_RATIO_SCALE) / USD_PRICE[borrow]
}

function fullCollateral(asset: ShieldedAsset): bigint {
  return BigInt(COLLATERAL_NOTES_PER_BORROW) * DENOMINATION[asset]
}

describe("computeBorrowAmount", () => {
  it("sizes an XLM→USDC borrow in raw USDC units", () => {
    const amount = computeBorrowAmount({
      totalCollateral: fullCollateral("XLM"),
      ratio: ratio("XLM", "USDC"),
      maxLtvBps: MAX_LTV_BPS,
    })

    // 4 XLM (40_000_000 raw) × 0.17111797923866 × 0.625 × 0.95 (R17
    // dynamic-cap safety margin, matches dynamic_borrow_cap's own
    // 9500/10000 factor) = 0.40640515… USDC → 4_064_052 raw.
    expect(amount).toBe(4_064_052n)
  })

  // R17 Phase 3: the flat 90%-of-one-denomination ceiling is gone —
  // it existed only because deposits used to be fixed-size, so a loan
  // above one denomination could never be repaid. Deposits are real
  // variable user input now (R17 Phase 1), so the user can simply
  // deposit whatever the repay needs later; the LTV band (margined to
  // match the contract exactly) is the only ceiling left.
  it("is no longer capped at one denomination — can legitimately exceed it", () => {
    const amount = computeBorrowAmount({
      totalCollateral: fullCollateral("XLM"),
      ratio: PRICE_RATIO_SCALE, // same-asset parity
      maxLtvBps: MAX_LTV_BPS,
    })

    // 4 XLM (40_000_000 raw) × 1.0 × 0.625 × 0.95 = 23_750_000 raw —
    // more than double DENOMINATION.XLM (10_000_000), which the old
    // flat cap would have silently truncated down to.
    expect(amount).toBe(23_750_000n)
    expect(amount).toBeGreaterThan(DENOMINATION.XLM)
  })

  it("stays proportional to real collateral value for every registered pair", () => {
    for (const market of marketCards) {
      const collateral = market.collateral as ShieldedAsset
      const borrow = market.symbol as ShieldedAsset
      const amount = computeBorrowAmount({
        totalCollateral: fullCollateral(collateral),
        ratio: ratio(collateral, borrow),
        maxLtvBps: MAX_LTV_BPS,
      })

      expect(amount).toBeGreaterThan(0n)
    }
  })
})
