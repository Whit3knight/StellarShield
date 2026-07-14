import { describe, expect, it } from "vitest"

import { canSubmitTransaction, shouldShowTransaction } from "./gates"
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
