import { describe, expect, it } from "vitest"

import { DENOMINATION } from "@/features/notes"

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

// R17: CurrentTotals tracks real VALUE (raw token units), not note
// counts — a deposit event's `amount` field undoes the exact amount
// deposited, not a flat `1`.

describe("undoDelta — real amounts (R17 event bodies)", () => {
  it("undoes a deposit by removing its real declared amount", () => {
    const running = totals({ d: 50_000_000, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "deposit",
      asset1: "XLM",
      asset2: null,
      isLoan: false,
      amount: 7_500_000n,
    })
    expect(running.XLM.totalDeposits).toBe(42_500_000)
  })

  it("undoes a borrow using the real collateral amount consumed and real loan amount minted", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 4_000_000 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "borrow",
      asset1: "XLM",
      asset2: "USDC",
      isLoan: false,
      amount: 4_000_000n,
      collateralAmount: 39_000_000n,
    })
    expect(running.XLM.totalDeposits).toBe(39_000_000)
    expect(running.USDC.totalBorrows).toBe(0)
  })

  it("undoes a deposit-tree withdraw by restoring its real amount", () => {
    const running = totals({ d: 30_000_000, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "withdraw",
      asset1: "XLM",
      asset2: null,
      isLoan: false,
      amount: 10_000_000n,
    })
    expect(running.XLM.totalDeposits).toBe(40_000_000)
  })

  it("undoes a loan-tree withdraw (claim) by restoring its real amount", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "withdraw",
      asset1: "XLM",
      asset2: null,
      isLoan: true,
      amount: 4_275_000n,
    })
    expect(running.XLM.totalBorrows).toBe(4_275_000)
  })
})

describe("undoDelta — amount fallback (pre-R17 events, no amount field)", () => {
  it("falls back to DENOMINATION when a deposit event carries no amount", () => {
    const running = totals({ d: 50_000_000, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "deposit",
      asset1: "XLM",
      asset2: null,
      isLoan: false,
      amount: null,
    })
    expect(running.XLM.totalDeposits).toBe(50_000_000 - Number(DENOMINATION.XLM))
  })

  it("falls back to DENOMINATION * 4 for a pre-R17 borrow's collateral side", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 1_000_000 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "borrow",
      asset1: "XLM",
      asset2: "USDC",
      isLoan: false,
      amount: null,
      collateralAmount: null,
    })
    expect(running.XLM.totalDeposits).toBe(Number(DENOMINATION.XLM * 4n))
    expect(running.USDC.totalBorrows).toBe(1_000_000 - Number(DENOMINATION.USDC))
  })
})

describe("undoDelta — repay (always DENOMINATION: repay never publishes an amount)", () => {
  it("undoes a repay by restoring one DENOMINATION of both deposit and borrow", () => {
    const running = totals({ d: 0, b: 0 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, { type: "repay", asset1: "EURC", asset2: null, isLoan: false })
    expect(running.EURC.totalDeposits).toBe(Number(DENOMINATION.EURC))
    expect(running.EURC.totalBorrows).toBe(Number(DENOMINATION.EURC))
  })
})

describe("undoDelta — malformed input", () => {
  it("ignores an event whose asset couldn't be decoded", () => {
    const running = totals({ d: 5, b: 2 }, { d: 0, b: 0 }, { d: 0, b: 0 })
    undoDelta(running, {
      type: "deposit",
      asset1: null,
      asset2: null,
      isLoan: false,
      amount: 1_000_000n,
    })
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
