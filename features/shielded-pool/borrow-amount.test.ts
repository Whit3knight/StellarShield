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
      denomination: DENOMINATION.USDC,
    })

    // 4 XLM (40_000_000 raw) × 0.17111797923866 × 0.625
    //   = 0.427794948… USDC → 4_277_949 raw.
    expect(amount).toBe(4_277_949n)
    // Under the cap, so the LTV band — not the cap — set this value.
    expect(amount).toBeLessThan((DENOMINATION.USDC * 9n) / 10n)
  })

  it("caps a same-asset borrow at 90% of one denomination", () => {
    const amount = computeBorrowAmount({
      totalCollateral: fullCollateral("XLM"),
      ratio: PRICE_RATIO_SCALE,
      maxLtvBps: MAX_LTV_BPS,
      denomination: DENOMINATION.XLM,
    })

    // Raw LTV sizing is 4 XLM × 0.625 = 2.5 XLM, which repay.circom
    // could never close against a single 1 XLM deposit note.
    expect(amount).toBe((DENOMINATION.XLM * 9n) / 10n)
    expect(amount).toBe(9_000_000n)
  })

  it("never exceeds one borrow-asset denomination for any registered pair", () => {
    // The guard that catches future drift: repay burns ONE deposit
    // note, and borrow_shielded rejects anything above the
    // denomination outright (Error #11).
    for (const market of marketCards) {
      const collateral = market.collateral as ShieldedAsset
      const borrow = market.symbol as ShieldedAsset
      const amount = computeBorrowAmount({
        totalCollateral: fullCollateral(collateral),
        ratio: ratio(collateral, borrow),
        maxLtvBps: MAX_LTV_BPS,
        denomination: DENOMINATION[borrow],
      })

      expect(amount).toBeGreaterThan(0n)
      expect(amount <= DENOMINATION[borrow]).toBe(true)
    }
  })
})
