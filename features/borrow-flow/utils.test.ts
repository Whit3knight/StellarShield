import { describe, expect, it } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { marketCards } from "@/features/markets"

import { INITIAL_FLOW_STATE } from "./constants"
import { createUserPosition } from "./positions"
import {
  createBorrowIntentFromFlow,
  createBorrowProof,
  createTransactionPreview,
  formatAssetAmount,
  formatPairPrice,
  formatUsd,
  getBorrowFlowMetrics,
  getCollateralValidationError,
  getLoanValidationError,
  parseAmount,
} from "./utils"

const account: ConnectedAccount = {
  wallet: {
    address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
    balance: "9,999.99998 XLM",
    balances: {
      XLM: "9,999.99998 XLM",
    },
    providerId: "freighter",
    providerName: "Freighter",
    shortAddress: "GDU3...Y9KQ",
  },
}
const market = marketCards[0]

describe("borrow flow utilities", () => {
  it("parses display amounts into numbers", () => {
    expect(parseAmount("$6,800.50")).toBe(6800.5)
    expect(parseAmount("9,999.99998 XLM")).toBe(9999.99998)
    expect(parseAmount("")).toBe(0)
    expect(parseAmount("not an amount")).toBe(0)
  })

  it("formats USD values consistently", () => {
    expect(formatUsd(100)).toBe("$100.00")
    expect(formatUsd(6800)).toBe("$6,800.00")
  })

  it("formats asset amounts", () => {
    expect(formatAssetAmount(3000, "XLM")).toBe("3,000 XLM")
    expect(formatAssetAmount(0.25, "EURC")).toBe("0.25 EURC")
  })

  it("formats market pair prices", () => {
    expect(formatPairPrice(market)).toBe("1 USDC = 8.333333 XLM")
  })

  it("validates collateral boundaries", () => {
    expect(
      getCollateralValidationError({
        amount: 50,
        balance: 9999,
        hasWallet: true,
        symbol: "XLM",
        valueUsd: 6,
      })
    ).toBe("Collateral value must be at least $10.00.")
    expect(
      getCollateralValidationError({
        amount: 10_000,
        balance: 9999,
        hasWallet: true,
        symbol: "XLM",
        valueUsd: 1200,
      })
    ).toBe("Collateral exceeds available XLM balance.")
    expect(
      getCollateralValidationError({
        amount: 100,
        balance: 9999,
        hasWallet: true,
        symbol: "XLM",
        valueUsd: 12,
      })
    ).toBeNull()
    expect(
      getCollateralValidationError({
        amount: 100,
        balance: 0,
        hasWallet: false,
        symbol: "XLM",
        valueUsd: 12,
      })
    ).toBe("Connect wallet to continue.")
  })

  it("validates loan amount against the minimum and borrowing power", () => {
    expect(getLoanValidationError(49, 225)).toBe(
      "Loan amount must be at least $50.00."
    )
    expect(getLoanValidationError(226, 225)).toBe(
      "Loan amount exceeds current borrowing power."
    )
    expect(getLoanValidationError(225, 225)).toBeNull()
  })

  it("computes borrow quote metrics and health states", () => {
    expect(
      getBorrowFlowMetrics(
        {
          collateralAmount: "3000",
          loanAmount: "180",
        },
        market,
        account
      )
    ).toMatchObject({
      borrowingPower: 225,
      collateralAmount: 3000,
      collateralValue: 360,
      collateralWalletBalance: 9999.99998,
      healthFactor: 1.6,
      isLoanValid: true,
      liquidationPrice: 0.075,
      loanAmount: 180,
      loanHealth: "Healthy",
      loanValue: 180,
      maxLoanAmount: 225,
      quote: {
        estimatedFee: {
          amount: 0.00003,
          symbol: "XLM",
          valueUsd: 0.0000036,
        },
        market: "USDC/XLM",
      },
      utilization: 0.8,
    })

    expect(
      getBorrowFlowMetrics(
        {
          collateralAmount: "3000",
          loanAmount: "220",
        },
        market,
        account
      )
    ).toMatchObject({
      isLoanValid: true,
      loanHealth: "Attention",
    })

    expect(
      getBorrowFlowMetrics(
        {
          collateralAmount: "3000",
          loanAmount: "230",
        },
        market,
        account
      )
    ).toMatchObject({
      isLoanValid: false,
      loanHealth: "At risk",
      validationError: "Loan amount exceeds current borrowing power.",
    })

    expect(
      getBorrowFlowMetrics(
        {
          collateralAmount: "3000",
          loanAmount: "180",
        },
        market,
        null
      )
    ).toMatchObject({
      isLoanValid: false,
      validationError: "Connect wallet to continue.",
    })
  })

  it("creates proof and position records from a valid quote", () => {
    const metrics = getBorrowFlowMetrics(
      {
        collateralAmount: "1000",
        loanAmount: "50",
      },
      market,
      account
    )

    expect(createBorrowProof({ account, market, metrics })).toMatchObject({
      publicInputs: {
        healthFactorMin: "1.25",
        market: "USDC/XLM",
        maxLtv: "63%",
      },
      status: "Verified",
    })
    const proof = createBorrowProof({ account, market, metrics })

    expect(
      createBorrowIntentFromFlow({ account, metrics, proof })
    ).toMatchObject({
      borrow: { amount: 50, symbol: "USDC", valueUsd: 50 },
      collateral: { amount: 1000, symbol: "XLM", valueUsd: 120 },
      market: "USDC/XLM",
      proofId: proof.id,
    })
    expect(
      createUserPosition({
        flow: {
          ...INITIAL_FLOW_STATE,
          borrowIntent: createBorrowIntentFromFlow({ account, metrics, proof }),
        },
        market,
        metrics,
        now: Date.UTC(2026, 6, 9),
        receipt: {
          confirmedAt: "2026-07-09T00:00:00.000Z",
          hash: "3f6d...91b2",
          network: "stellar-testnet",
        },
      })
    ).toMatchObject({
      borrowed: [{ amount: 50, symbol: "USDC", valueUsd: 50 }],
      market: "USDC/XLM",
      receiptHash: "3f6d...91b2",
      status: "Open",
      supplied: [{ amount: 1000, symbol: "XLM", valueUsd: 120 }],
    })
  })

  it("creates transaction previews from quote state", () => {
    const flow = {
      ...INITIAL_FLOW_STATE,
      collateralAmount: "1000",
      loanAmount: "50",
    }
    const metrics = getBorrowFlowMetrics(flow, market, account)

    expect(
      createTransactionPreview({ account, flow, market, metrics })
    ).toMatchObject({
      account: "GDU3...Y9KQ",
      collateral: "1,000 XLM",
      estimatedFee: "0.00003 XLM",
      loan: "50 USDC",
      market: "USDC/XLM",
      proof: "Required before submission",
      receipt: null,
      verification: "Not started",
    })
  })
})
