import { describe, expect, it } from "vitest"

import { generateBorrowProof } from "."

describe("mock borrow prover", () => {
  it("creates deterministic public proof output", () => {
    expect(
      generateBorrowProof({
        account: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
        borrow: {
          amount: 50,
          symbol: "USDC",
          valueUsd: 50,
        },
        collateral: {
          amount: 1000,
          symbol: "XLM",
          valueUsd: 120,
        },
        healthFactor: 1.92,
        healthFactorMin: 1.25,
        isEligible: true,
        market: "USDC/XLM",
        maxLtv: 0.625,
        now: Date.UTC(2026, 6, 9),
      })
    ).toEqual({
      claim: "Borrow eligibility verified",
      expiresAt: "2026-07-09T00:10:00.000Z",
      id: "proof-182oqq4",
      publicInputs: {
        healthFactorMin: "1.25",
        market: "USDC/XLM",
        maxLtv: "63%",
      },
      status: "Verified",
    })
  })

  it("marks ineligible proof requests as failed", () => {
    expect(
      generateBorrowProof({
        account: null,
        borrow: {
          amount: 230,
          symbol: "USDC",
          valueUsd: 230,
        },
        collateral: {
          amount: 3000,
          symbol: "XLM",
          valueUsd: 360,
        },
        healthFactor: 1.25,
        healthFactorMin: 1.25,
        isEligible: false,
        market: "USDC/XLM",
        maxLtv: 0.625,
        now: Date.UTC(2026, 6, 9),
      }).status
    ).toBe("Failed")
  })
})
