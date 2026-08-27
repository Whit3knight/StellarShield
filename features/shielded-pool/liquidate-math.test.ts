import { describe, expect, it } from "vitest"

import { collateralNow, isUnderwater } from "./liquidate-math"
import { PRICE_RATIO_SCALE } from "@/features/markets/prices"

// Same fixture as components/organisms/loan-health.test.ts: 4 XLM
// collateral backing a loan opened at the 6250bps max LTV with XLM at
// $0.171 (~160% HF). Reused here to cross-check that this formula and
// loan-health.ts's `atRisk` never disagree — see docs/REMEDIATION.md
// R22 (both used to be dimensionally/conventionally inconsistent).
const OPEN_XLM_USD = 0.171
const COLLATERAL_RAW = 40_000_000n
const LOAN_RAW = 4_277_949n
const OPEN_RATIO = BigInt(Math.round(OPEN_XLM_USD * 1e14))
const COLLATERAL_NOTIONAL = COLLATERAL_RAW * OPEN_RATIO

function ratioAt(xlmUsd: number): bigint {
  return BigInt(Math.round(xlmUsd * 1e14))
}

function underwaterAt(xlmUsd: number, thresholdBps = 8_000): boolean {
  return isUnderwater({
    loanAmount: LOAN_RAW,
    collateralNotional: COLLATERAL_NOTIONAL,
    borrowPrice: OPEN_RATIO,
    currentPrice: ratioAt(xlmUsd),
    thresholdBps,
  })
}

describe("collateralNow", () => {
  it("descales to collateralNotional/PRICE_RATIO_SCALE when price hasn't moved", () => {
    // current === borrowPrice cancels the price term entirely, leaving
    // exactly the open-time value with its price scale removed.
    expect(
      collateralNow({
        collateralNotional: COLLATERAL_NOTIONAL,
        borrowPrice: OPEN_RATIO,
        currentPrice: OPEN_RATIO,
      })
    ).toBe(COLLATERAL_NOTIONAL / PRICE_RATIO_SCALE)
  })

  it("scales linearly with currentPrice", () => {
    const atOpen = collateralNow({
      collateralNotional: COLLATERAL_NOTIONAL,
      borrowPrice: OPEN_RATIO,
      currentPrice: OPEN_RATIO,
    })
    const atHalf = collateralNow({
      collateralNotional: COLLATERAL_NOTIONAL,
      borrowPrice: OPEN_RATIO,
      currentPrice: OPEN_RATIO / 2n,
    })
    expect(atHalf).toBe(atOpen / 2n)
  })
})

describe("isUnderwater", () => {
  it("is healthy at the open price", () => {
    expect(underwaterAt(OPEN_XLM_USD)).toBe(false)
  })

  it("is healthy a hair above the 8000bps boundary, underwater a hair below it", () => {
    // Same boundary loan-health.test.ts proves for this exact fixture.
    expect(underwaterAt(0.133_686)).toBe(false)
    expect(underwaterAt(0.133_685_9)).toBe(true)
  })

  it("flags a clearly underwater position", () => {
    expect(underwaterAt(OPEN_XLM_USD * 0.5)).toBe(true)
    expect(underwaterAt(OPEN_XLM_USD * 0.01)).toBe(true)
  })

  it("respects a wider threshold — same -25% move is at risk at 8000bps but not 8500bps", () => {
    expect(underwaterAt(OPEN_XLM_USD * 0.75, 8_000)).toBe(true)
    expect(underwaterAt(OPEN_XLM_USD * 0.75, 8_500)).toBe(false)
  })

  it("cross-checks against loan-health.ts's atRisk at every boundary case above", async () => {
    const { loanHealth } = await import("@/components/organisms/loan-health")
    for (const [xlmUsd, thresholdBps] of [
      [OPEN_XLM_USD, 8_000],
      [0.133_686, 8_000],
      [0.133_685_9, 8_000],
      [OPEN_XLM_USD * 0.5, 8_000],
      [OPEN_XLM_USD * 0.75, 8_000],
      [OPEN_XLM_USD * 0.75, 8_500],
    ] as const) {
      const health = loanHealth({
        bond: {
          borrowPrice: OPEN_RATIO,
          collateralAsset: "XLM",
          collateralValue: COLLATERAL_NOTIONAL,
          saltAmount: 1n,
          saltPrice: 3n,
          saltValue: 2n,
        },
        loanAmount: LOAN_RAW,
        loanAsset: "USDC",
        prices: { EURC: 1.08, USDC: 1, XLM: xlmUsd },
        thresholdBps,
      })
      expect(underwaterAt(xlmUsd, thresholdBps)).toBe(health?.atRisk)
    }
  })
})
