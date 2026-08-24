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

const stat = (deposits: number, borrows: number): MarketStat =>
  ({ totalDeposits: deposits, totalBorrows: borrows }) as MarketStat

describe("hasBorrowLiquidity", () => {
  it("passes when deposits exceed borrows", () => {
    expect(hasBorrowLiquidity(stat(5, 3))).toBe(true)
  })

  it("fails when the pool is fully borrowed or empty", () => {
    expect(hasBorrowLiquidity(stat(3, 3))).toBe(false)
    expect(hasBorrowLiquidity(stat(0, 0))).toBe(false)
  })

  it("doesn't block when no snapshot has loaded yet", () => {
    expect(hasBorrowLiquidity(undefined)).toBe(true)
  })
})
