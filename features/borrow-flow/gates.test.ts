import { describe, expect, it } from "vitest"

import type { MarketStat } from "@/features/markets"

import {
  canSubmitTransaction,
  hasBorrowLiquidity,
  shouldShowTransaction,
} from "./gates"
import type { BorrowFlowMetrics, Transaction } from "./types"

const validMetrics = { isLoanValid: true } as BorrowFlowMetrics

const readyTx: Transaction = {
  status: "Ready",
  intent: {} as never,
  payload: {} as never,
}

describe("canSubmitTransaction", () => {
  it("fires only on Verified + valid loan + Ready tx", () => {
    expect(
      canSubmitTransaction({
        metrics: validMetrics,
        status: "Verified",
        transaction: readyTx,
      })
    ).toBe(true)
    expect(
      canSubmitTransaction({
        metrics: validMetrics,
        status: "Verified",
        transaction: { status: "Signing", intent: {} as never, payload: {} as never },
      })
    ).toBe(false)
  })
})

describe("shouldShowTransaction", () => {
  it("stays true through the whole submit lifecycle", () => {
    const transactions: Transaction[] = [
      { status: "Signing", intent: {} as never, payload: {} as never },
      { status: "Submitted", intent: {} as never, payload: {} as never },
      { status: "Confirmed", intent: {} as never, payload: {} as never, receipt: {} as never },
      { status: "Failed", intent: {} as never, payload: {} as never },
    ]
    for (const transaction of transactions) {
      expect(
        shouldShowTransaction({
          metrics: validMetrics,
          status: "Verified",
          transaction,
        })
      ).toBe(true)
    }
  })

  it("matches canSubmit before submit starts", () => {
    expect(
      shouldShowTransaction({
        metrics: validMetrics,
        status: "Verified",
        transaction: readyTx,
      })
    ).toBe(true)
    expect(
      shouldShowTransaction({
        metrics: validMetrics,
        status: "Not started",
        transaction: { status: "Draft" },
      })
    ).toBe(false)
  })
})

const stat = (availableBalance: bigint): MarketStat =>
  ({ availableBalance }) as MarketStat

describe("hasBorrowLiquidity", () => {
  it("passes when the requested amount is within the pool's real balance", () => {
    expect(hasBorrowLiquidity(stat(12_000_000n), 10_000_000n)).toBe(true)
  })

  it("fails when the requested amount exceeds the pool's balance", () => {
    expect(hasBorrowLiquidity(stat(3_000_000n), 10_000_000n)).toBe(false)
    expect(hasBorrowLiquidity(stat(0n), 1n)).toBe(false)
  })

  // R29: a nonzero pool balance used to pass regardless of how much
  // was actually being requested (only a flat 1-denomination floor
  // was checked) — this is the exact shape of bug a real user hit:
  // requesting 30 XLM against an 8.1 XLM pool.
  it("fails a large request even against a comfortably nonzero balance", () => {
    expect(hasBorrowLiquidity(stat(81_000_000n), 300_000_000n)).toBe(false)
    expect(hasBorrowLiquidity(stat(81_000_000n), 30_000_000n)).toBe(true)
  })

  it("doesn't block when no snapshot has loaded yet", () => {
    expect(hasBorrowLiquidity(undefined, 10_000_000n)).toBe(true)
  })
})
