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
  it("passes when the pool's real balance clears one denomination", () => {
    expect(hasBorrowLiquidity(stat(12_000_000n), "XLM")).toBe(true)
  })

  it("fails when the balance is below one denomination", () => {
    expect(hasBorrowLiquidity(stat(3_000_000n), "XLM")).toBe(false)
    expect(hasBorrowLiquidity(stat(0n), "XLM")).toBe(false)
  })

  it("uses the asset's own denomination as the floor", () => {
    // USDC's denomination (5_000_000) is half XLM's — the same raw
    // balance clears USDC's floor but not XLM's.
    expect(hasBorrowLiquidity(stat(7_000_000n), "USDC")).toBe(true)
    expect(hasBorrowLiquidity(stat(7_000_000n), "XLM")).toBe(false)
  })

  it("doesn't block when no snapshot has loaded yet", () => {
    expect(hasBorrowLiquidity(undefined, "XLM")).toBe(true)
  })
})
