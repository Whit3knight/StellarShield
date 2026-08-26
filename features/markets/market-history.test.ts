import { describe, expect, it } from "vitest"

import { bucketBoundaries, undoDelta, type CurrentTotals } from "./market-history"

const totals = (
  xlm: { d: number; b: number },
  usdc: { d: number; b: number },
  eurc: { d: number; b: number }
): CurrentTotals => ({
  EURC: { totalBorrows: eurc.b, totalDeposits: eurc.d },
  USDC: { totalBorrows: usdc.b, totalDeposits: usdc.d },
  XLM: { totalBorrows: xlm.b, totalDeposits: xlm.d },
})

describe("undoDelta", () => {
  it("undoes a deposit by removing 1 note", () => {
    const running = totals({ d: 5, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "deposit", asset1: "XLM", asset2: null, isLoan: false })
    expect(running.XLM.totalDeposits).toBe(4)
  })

  it("undoes a borrow: +4 collateral deposits, -1 loan borrow", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 1 }, { d: 0, b: 0 })
    undoDelta(running, { type: "borrow", asset1: "XLM", asset2: "USDC", isLoan: false })
    expect(running.XLM.totalDeposits).toBe(4)
    expect(running.USDC.totalBorrows).toBe(0)
  })

  it("undoes a deposit-tree withdraw by restoring 1 deposit note", () => {
    const running = totals({ d: 3, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "withdraw", asset1: "XLM", asset2: null, isLoan: false })
    expect(running.XLM.totalDeposits).toBe(4)
  })

  it("undoes a loan-tree withdraw (claim) by restoring 1 borrow note", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "withdraw", asset1: "XLM", asset2: null, isLoan: true })
    expect(running.XLM.totalBorrows).toBe(1)
  })

  it("undoes a repay by restoring both 1 deposit and 1 borrow note", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "repay", asset1: "EURC", asset2: null, isLoan: false })
    expect(running.EURC.totalDeposits).toBe(1)
    expect(running.EURC.totalBorrows).toBe(1)
  })

  it("ignores an event whose asset couldn't be decoded", () => {
    const running = totals({ d: 5, b: 2 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "deposit", asset1: null, asset2: null, isLoan: false })
    expect(running.XLM).toEqual({ totalBorrows: 2, totalDeposits: 5 })
  })
})

describe("bucketBoundaries", () => {
  it("returns 8 boundaries, oldest first, ending exactly at now", () => {
    const now = 1_000_000
    const boundaries = bucketBoundaries(now)
    expect(boundaries).toHaveLength(8)
    expect(boundaries[7]).toBe(now)
    expect(boundaries[0]).toBe(now - 7 * 24 * 60 * 60)
  })

  it("is strictly increasing", () => {
    const boundaries = bucketBoundaries(2_000_000)
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]).toBeGreaterThan(boundaries[i - 1])
    }
  })
})
