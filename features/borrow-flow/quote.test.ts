import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { marketCards } from "@/features/markets"
import { writeCachedAssetPrice } from "@/features/markets/price-cache"

import { createBorrowQuote } from "./quote"

// XLM/USDC: loan = XLM, collateral = USDC.
function requireMarket() {
  const found = marketCards.find(
    (m) => m.symbol === "XLM" && m.collateral === "USDC"
  )
  if (!found) throw new Error("XLM/USDC market fixture missing")
  return found
}
const market = requireMarket()

function quote(
  collateralAmount: string,
  loanAmount: string,
  account: ConnectedAccount | null = null
) {
  return createBorrowQuote({
    account,
    flow: { collateralAmount, loanAmount },
    market,
  })
}

// Funded so the wallet-balance gate doesn't shadow the LTV boundary
// this account exists to isolate.
const fundedAccount: ConnectedAccount = {
  wallet: {
    address: "GTEST",
    balance: "1000",
    balances: { USDC: "1000" },
    providerId: "freighter",
    providerName: "Freighter",
    shortAddress: "GTES…TEST",
  },
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
  // 100 USDC @ $1 collateral, 50 XLM @ $1 loan.
  // borrowingPower = 100 * 0.625 = 62.5
  // healthFactor   = (100 * 0.8) / 50 = 1.6
  // utilization    = 50 / 62.5 = 0.8
  // liquidationPx  = 50 / (100 * 0.8) = 0.625
  // maxLoan        = 100 * 1.0(ratio) * 0.625(maxLtv) * 0.95(R17 dynamic-
  //                  cap safety margin, matches computeBorrowAmount) = 59.375
  it("derives borrowing power, health, utilization, and liquidation price", () => {
    const q = quote("100", "50")
    expect(q.collateral.valueUsd).toBeCloseTo(100, 6)
    expect(q.loan.valueUsd).toBeCloseTo(50, 6)
    expect(q.borrowingPower).toBeCloseTo(62.5, 6)
    expect(q.healthFactor).toBeCloseTo(1.6, 6)
    expect(q.utilization).toBeCloseTo(0.8, 6)
    expect(q.liquidationPrice).toBeCloseTo(0.625, 6)
    expect(q.maxLoanAmount).toBeCloseTo(59.375, 6)
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

  // Zero collateral with a non-zero loan is a distinct path from the
  // zero-loan case above: healthFactor's own isZero check only looks
  // at the loan side, so it returns 0 (maximally unhealthy) here, not
  // null — worth pinning down since it's easy to conflate the two
  // "zero" edges.
  it("health factor is 0 (not null) when collateral is zero but loan is not", () => {
    const q = quote("0", "50")
    expect(q.healthFactor).toBe(0)
    expect(q.maxLoanAmount).toBe(0)
  })

  // borrowingPower = 100 * 0.625 = 62.5 exactly. getLoanValidationError
  // only rejects strictly-greater, so the boundary itself is valid.
  it("max-LTV boundary: loan valued exactly at borrowing power is valid, one cent over is not", () => {
    const atLimit = quote("100", "62.5", fundedAccount)
    expect(atLimit.validationError).toBeNull()

    const overLimit = quote("100", "62.51", fundedAccount)
    expect(overLimit.validationError).toBe(
      "Loan amount exceeds current borrowing power."
    )
  })

  // Assets here use 7 raw decimals (see features/markets/data.ts). An
  // 8th fractional digit is finer than the smallest on-chain unit and
  // must truncate away, not round up into a phantom unit.
  it("truncates amounts finer than the asset's raw denomination instead of rounding up", () => {
    const belowGranularity = quote("0.00000001", "")
    expect(belowGranularity.collateral.amount).toBe(0)

    const atGranularity = quote("0.0000001", "")
    expect(atGranularity.collateral.amount).toBeCloseTo(0.0000001, 10)
  })

  it("scales health factor inversely with loan size", () => {
    const small = quote("100", "25")
    const large = quote("100", "50")
    expect(small.healthFactor).toBeCloseTo(3.2, 6)
    expect(large.healthFactor).toBeCloseTo(1.6, 6)
  })
})
