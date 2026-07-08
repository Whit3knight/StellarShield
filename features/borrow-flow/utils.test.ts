import { describe, expect, it } from "vitest"

import {
  formatUsd,
  getBorrowFlowMetrics,
  getCollateralValidationError,
  getLoanValidationError,
  parseAmount,
} from "./utils"

describe("borrow flow utilities", () => {
  it("parses display amounts into numbers", () => {
    expect(parseAmount("$6,800.50")).toBe(6800.5)
    expect(parseAmount("")).toBe(0)
    expect(parseAmount("not an amount")).toBe(0)
  })

  it("formats USD values consistently", () => {
    expect(formatUsd(100)).toBe("$100.00")
    expect(formatUsd(6800)).toBe("$6,800.00")
  })

  it("validates collateral boundaries", () => {
    expect(getCollateralValidationError(99)).toBe(
      "Collateral must be at least $100.00."
    )
    expect(getCollateralValidationError(6801)).toBe(
      "Collateral cannot exceed $6,800.00."
    )
    expect(getCollateralValidationError(100)).toBeNull()
    expect(getCollateralValidationError(6800)).toBeNull()
  })

  it("validates loan amount against the minimum and borrowing power", () => {
    expect(getLoanValidationError(49, 625)).toBe(
      "Loan amount must be at least $50.00."
    )
    expect(getLoanValidationError(626, 625)).toBe(
      "Loan amount exceeds current borrowing power."
    )
    expect(getLoanValidationError(625, 625)).toBeNull()
  })

  it("computes loan metrics and health states", () => {
    expect(
      getBorrowFlowMetrics({
        collateralAmount: "1000",
        loanAmount: "500",
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      })
    ).toMatchObject({
      borrowingPower: 625,
      collateralValue: 1000,
      isLoanValid: true,
      loanHealth: "Healthy",
      loanValue: 500,
      utilization: 0.8,
    })

    expect(
      getBorrowFlowMetrics({
        collateralAmount: "1000",
        loanAmount: "600",
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      })
    ).toMatchObject({
      isLoanValid: true,
      loanHealth: "Attention",
    })

    expect(
      getBorrowFlowMetrics({
        collateralAmount: "1000",
        loanAmount: "700",
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      })
    ).toMatchObject({
      isLoanValid: false,
      loanHealth: "At risk",
    })
  })
})
