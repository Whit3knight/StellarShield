import { describe, expect, it } from "vitest"

import { buildBorrowProof, mockBorrowProverAdapter } from "./mock-prover"

describe("mock borrow prover", () => {
  it("creates deterministic public proof output", () => {
    expect(
      buildBorrowProof({
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
      generatedAt: "2026-07-09T00:00:00.000Z",
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
      buildBorrowProof({
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

  it("expires 10 minutes after the injected clock", () => {
    const now = Date.UTC(2026, 6, 9, 12, 0, 0)
    const proof = buildBorrowProof({
      account: "GDU3",
      borrow: { amount: 50, symbol: "USDC", valueUsd: 50 },
      collateral: { amount: 1000, symbol: "XLM", valueUsd: 120 },
      healthFactor: 1.92,
      healthFactorMin: 1.25,
      isEligible: true,
      market: "USDC/XLM",
      maxLtv: 0.625,
      now,
    })

    expect(proof.expiresAt).toBe(new Date(now + 10 * 60 * 1000).toISOString())
  })

  it("produces stable ids across calls with equal inputs", () => {
    const params = {
      account: "GABC",
      borrow: { amount: 100, symbol: "USDC" as const, valueUsd: 100 },
      collateral: { amount: 2000, symbol: "XLM" as const, valueUsd: 240 },
      healthFactor: 1.9,
      healthFactorMin: 1.25,
      isEligible: true,
      market: "USDC/XLM",
      maxLtv: 0.625,
      now: Date.UTC(2026, 6, 9),
    }

    expect(buildBorrowProof(params).id).toBe(buildBorrowProof(params).id)
  })

  it("produces different ids when inputs differ", () => {
    const base = {
      account: "GABC",
      borrow: { amount: 100, symbol: "USDC" as const, valueUsd: 100 },
      collateral: { amount: 2000, symbol: "XLM" as const, valueUsd: 240 },
      healthFactor: 1.9,
      healthFactorMin: 1.25,
      isEligible: true,
      market: "USDC/XLM",
      maxLtv: 0.625,
      now: Date.UTC(2026, 6, 9),
    }

    const differentAmount = buildBorrowProof({
      ...base,
      borrow: { ...base.borrow, amount: 200 },
    })

    expect(differentAmount.id).not.toBe(buildBorrowProof(base).id)
  })

  it("resolves an AdapterResult through the adapter surface", async () => {
    const result = await mockBorrowProverAdapter.generateBorrowProof({
      account: "GABC",
      borrow: { amount: 50, symbol: "USDC", valueUsd: 50 },
      collateral: { amount: 1000, symbol: "XLM", valueUsd: 120 },
      healthFactor: 1.92,
      healthFactorMin: 1.25,
      isEligible: true,
      market: "USDC/XLM",
      maxLtv: 0.625,
      now: Date.UTC(2026, 6, 9),
    })

    expect(result.ok).toBe(true)
  })

  it("returns Aborted when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await mockBorrowProverAdapter.generateBorrowProof(
      {
        account: "GABC",
        borrow: { amount: 50, symbol: "USDC", valueUsd: 50 },
        collateral: { amount: 1000, symbol: "XLM", valueUsd: 120 },
        healthFactor: 1.92,
        healthFactorMin: 1.25,
        isEligible: true,
        market: "USDC/XLM",
        maxLtv: 0.625,
        now: Date.UTC(2026, 6, 9),
      },
      controller.signal
    )

    expect(result).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Proof generation aborted." },
    })
  })
})
