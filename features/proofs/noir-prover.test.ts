import { describe, expect, it } from "vitest"

import { createNoirBorrowProverAdapter } from "./noir-prover"

const baseParams = {
  account: "GABC",
  borrow: { amount: 50, symbol: "USDC" as const, valueUsd: 50 },
  collateral: { amount: 1000, symbol: "XLM" as const, valueUsd: 120 },
  healthFactor: 1.92,
  healthFactorMin: 1.25,
  isEligible: true,
  market: "USDC/XLM",
  maxLtv: 0.625,
  now: Date.UTC(2026, 6, 9),
}

describe("noir borrow prover", () => {
  it("returns Aborted when the signal is pre-aborted", async () => {
    const adapter = createNoirBorrowProverAdapter()
    const controller = new AbortController()
    controller.abort()

    const result = await adapter.generateBorrowProof(baseParams, controller.signal)

    expect(result).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Proof generation aborted." },
    })
  })

  it("returns Unknown error when noir deps or circuit artifact are missing", async () => {
    // Deps and compiled circuit are not installed in this environment;
    // the adapter must surface a clean AdapterError, not throw.
    const adapter = createNoirBorrowProverAdapter()
    const result = await adapter.generateBorrowProof(baseParams)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown")
    }
  })
})
