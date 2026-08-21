import { describe, expect, it } from "vitest"

import { loanHealth } from "./loan-health"

import type { ShieldedAsset } from "@/features/notes"

// Fixture: 4 XLM of collateral (raw stroops) backing a 0.4277949 USDC
// loan, opened with XLM at $0.171 — i.e. at the 6250bps max LTV, which
// is why par reads ~160%.
const OPEN_XLM_USD = 0.171
const COLLATERAL_RAW = 40_000_000n
const LOAN_RAW = 4_277_949n
const OPEN_RATIO = BigInt(Math.round(OPEN_XLM_USD * 1e14))

const BOND = {
  borrowPrice: OPEN_RATIO,
  collateralAsset: "XLM" as ShieldedAsset,
  collateralValue: COLLATERAL_RAW * OPEN_RATIO,
  saltAmount: 1n,
  saltPrice: 3n,
  saltValue: 2n,
}

function healthAt(
  xlmUsd: number,
  thresholdBps = 8_000
): ReturnType<typeof loanHealth> {
  return loanHealth({
    bond: BOND,
    loanAmount: LOAN_RAW,
    loanAsset: "USDC",
    prices: { EURC: 1.08, USDC: 1, XLM: xlmUsd },
    thresholdBps,
  })
}

describe("loanHealth", () => {
  it("reads ~160% and healthy at the open price", () => {
    expect(healthAt(OPEN_XLM_USD)).toEqual({ atRisk: false, hfPercent: 159 })
  })

  it("straddles the liquidation boundary at 8000bps (HF < 125%)", () => {
    expect(healthAt(0.133_686)).toEqual({ atRisk: false, hfPercent: 125 })
    expect(healthAt(0.133_685_9)).toEqual({ atRisk: true, hfPercent: 124 })
  })

  it("keeps the same position healthy under the 8500bps contract default", () => {
    // 8500bps trips at HF < 118%, so a -25% move is at risk at 8000
    // but not yet at 8500. Guards against the threshold being ignored.
    expect(healthAt(OPEN_XLM_USD * 0.75)).toEqual({
      atRisk: true,
      hfPercent: 119,
    })
    expect(healthAt(OPEN_XLM_USD * 0.75, 8_500)?.atRisk).toBe(false)
  })

  it("flags a clearly underwater position", () => {
    expect(healthAt(OPEN_XLM_USD * 0.5)).toEqual({ atRisk: true, hfPercent: 79 })
    expect(healthAt(OPEN_XLM_USD * 0.01)).toEqual({ atRisk: true, hfPercent: 1 })
  })

  it("returns null rather than a wrong number when a price is missing", () => {
    expect(healthAt(0)).toBeNull()
    expect(healthAt(-1)).toBeNull()
    expect(
      loanHealth({
        bond: BOND,
        loanAmount: LOAN_RAW,
        loanAsset: "USDC",
        prices: { EURC: 1.08, USDC: 0, XLM: OPEN_XLM_USD },
        thresholdBps: 8_000,
      })
    ).toBeNull()
  })

  it("returns null for a bond with no open price or a zero loan", () => {
    expect(
      loanHealth({
        bond: { ...BOND, borrowPrice: 0n },
        loanAmount: LOAN_RAW,
        loanAsset: "USDC",
        prices: { EURC: 1.08, USDC: 1, XLM: OPEN_XLM_USD },
        thresholdBps: 8_000,
      })
    ).toBeNull()
    expect(
      loanHealth({
        bond: BOND,
        loanAmount: 0n,
        loanAsset: "USDC",
        prices: { EURC: 1.08, USDC: 1, XLM: OPEN_XLM_USD },
        thresholdBps: 8_000,
      })
    ).toBeNull()
  })
})
