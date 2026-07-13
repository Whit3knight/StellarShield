import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { marketCards } from "@/features/markets"
import { writeCachedAssetPrice } from "@/features/markets/price-cache"

import { createBorrowQuote } from "./quote"

// USDC/XLM: loan = USDC, collateral = XLM.
function requireMarket() {
  const found = marketCards.find(
    (m) => m.symbol === "USDC" && m.collateral === "XLM"
  )
  if (!found) throw new Error("USDC/XLM market fixture missing")
  return found
}
const market = requireMarket()

function quote(collateralAmount: string, loanAmount: string) {
  return createBorrowQuote({
    account: null,
    flow: { collateralAmount, loanAmount },
    market,
  })
}

beforeEach(() => {
  // Pin both prices to 1 USD for clean arithmetic.
  writeCachedAssetPrice("XLM", 1)
  writeCachedAssetPrice("USDC", 1)
})

afterEach(() => {
  // Restore the static defaults so other suites see stable prices.
  writeCachedAssetPrice("XLM", 0.12)
  writeCachedAssetPrice("USDC", 1)
})

describe("createBorrowQuote math", () => {
  // 100 XLM @ $1 collateral, 50 USDC @ $1 loan.
  // borrowingPower = 100 * 0.625 = 62.5
  // healthFactor   = (100 * 0.8) / 50 = 1.6
  // utilization    = 50 / 62.5 = 0.8
  // liquidationPx  = 50 / (100 * 0.8) = 0.625
  // maxLoan        = 62.5 / 1 = 62.5
  it("derives borrowing power, health, utilization, and liquidation price", () => {
    const q = quote("100", "50")
    expect(q.collateral.valueUsd).toBeCloseTo(100, 6)
    expect(q.loan.valueUsd).toBeCloseTo(50, 6)
    expect(q.borrowingPower).toBeCloseTo(62.5, 6)
    expect(q.healthFactor).toBeCloseTo(1.6, 6)
    expect(q.utilization).toBeCloseTo(0.8, 6)
    expect(q.liquidationPrice).toBeCloseTo(0.625, 6)
    expect(q.maxLoanAmount).toBeCloseTo(62.5, 6)
  })

  it("returns null health and liquidation price when the loan is zero", () => {
    const q = quote("100", "")
    expect(q.healthFactor).toBeNull()
    expect(q.liquidationPrice).toBeNull()
    expect(q.utilization).toBe(0)
  })

  it("returns null liquidation price when collateral is zero", () => {
    const q = quote("0", "50")
    expect(q.liquidationPrice).toBeNull()
  })

  it("scales health factor inversely with loan size", () => {
    const small = quote("100", "25")
    const large = quote("100", "50")
    expect(small.healthFactor).toBeCloseTo(3.2, 6)
    expect(large.healthFactor).toBeCloseTo(1.6, 6)
  })
})
