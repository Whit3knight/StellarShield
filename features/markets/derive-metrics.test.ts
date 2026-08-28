import { describe, expect, it } from "vitest"

import {
  BASE_APR,
  deriveMarketMetrics,
  SLOPE_APR,
} from "./derive-metrics"
import type { MarketStat } from "./market-stats"

const stat = (overrides: Partial<MarketStat> = {}): MarketStat => ({
  chart: [],
  latestActivityAt: null,
  loanNextIndex: 0,
  openPositions: 0,
  totalBorrows: 0,
  totalDeposits: 0,
  totalRepays: 0,
  totalBorrowsValue: 0,
  totalDepositsValue: 0,
  availableBalance: 0n,
  ...overrides,
})

describe("deriveMarketMetrics utilization", () => {
  it("matches the contract's formula, not a naive deposit-only ratio", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 1, totalDepositsValue: 1 })
    )
    expect(metrics.utilization).toBe(0.5)
  })

  it("is 0 when both deposits and borrows are 0", () => {
    const metrics = deriveMarketMetrics(stat())
    expect(metrics.utilization).toBe(0)
  })

  it("is 0 when deposits are 0, even with outstanding borrows", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 5, totalDepositsValue: 0 })
    )
    expect(metrics.utilization).toBe(0)
  })

  it("is 0 when borrows are 0, regardless of deposits", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 0, totalDepositsValue: 5 })
    )
    expect(metrics.utilization).toBe(0)
  })

  it("computes borrow / (deposit + borrow) in the general case", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 1, totalDepositsValue: 3 })
    )
    expect(metrics.utilization).toBe(0.25)
  })
})

describe("deriveMarketMetrics borrowApr", () => {
  it("falls back to BASE_APR/SLOPE_APR when no rateParams are given", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 1, totalDepositsValue: 3 })
    )
    expect(metrics.borrowApr).toBeCloseTo(
      BASE_APR + SLOPE_APR * metrics.utilization,
      10
    )
  })

  it("uses the supplied rateParams instead of the hardcoded fallback", () => {
    const metrics = deriveMarketMetrics(
      stat({ totalBorrowsValue: 1, totalDepositsValue: 3 }),
      undefined,
      { baseApr: 0.05, slopeApr: 0.2 }
    )
    expect(metrics.borrowApr).toBeCloseTo(0.05 + 0.2 * metrics.utilization, 10)
    expect(metrics.borrowApr).not.toBeCloseTo(
      BASE_APR + SLOPE_APR * metrics.utilization,
      10
    )
  })
})

describe("deriveMarketMetrics openPositions", () => {
  it("stays a note count independent of value totals", () => {
    const metrics = deriveMarketMetrics(
      stat({ openPositions: 7, totalBorrowsValue: 999_999, totalDepositsValue: 1 })
    )
    expect(metrics.openPositions).toBe(7)
  })
})
