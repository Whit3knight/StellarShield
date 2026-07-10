import { describe, expect, it } from "vitest"

import {
  createNoirBorrowProverAdapter,
  fieldFromString,
  mapParamsToCircuitInputs,
  mockOracle,
} from "./noir-prover"

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

})

describe("mapParamsToCircuitInputs", () => {
  it("emits every field the circuit expects, in the right shape", () => {
    const inputs = mapParamsToCircuitInputs(baseParams, 1_720_000_000)

    expect(inputs.account.startsWith("0x")).toBe(true)
    expect(inputs.market.startsWith("0x")).toBe(true)
    expect(inputs.proof_id.startsWith("0x")).toBe(true)
    expect(inputs.collateral_symbol.startsWith("0x")).toBe(true)
    expect(inputs.borrow_symbol.startsWith("0x")).toBe(true)
    expect(inputs.collateral_amount).toBe("1000")
    expect(inputs.borrow_amount).toBe("50")
    expect(inputs.hf_min_bps).toBe("12500")
    expect(inputs.max_ltv_bps).toBe("6250")
    expect(inputs.oracle_epoch).toBe("1720000000")
    expect(inputs.oracle_price).toBe("1")
    expect(inputs.raw_collateral_balance).toBe(inputs.collateral_amount)
  })

  it("produces stable outputs across calls with identical inputs", () => {
    const first = mapParamsToCircuitInputs(baseParams, 1_720_000_000)
    const second = mapParamsToCircuitInputs(baseParams, 1_720_000_000)
    expect(first).toEqual(second)
  })

  it("changes proof_id when a bindable field changes", () => {
    const base = mapParamsToCircuitInputs(baseParams, 1_720_000_000)
    const bigger = mapParamsToCircuitInputs(
      { ...baseParams, borrow: { ...baseParams.borrow, amount: 200 } },
      1_720_000_000
    )
    expect(base.proof_id).not.toBe(bigger.proof_id)
  })
})

describe("mockOracle", () => {
  it("returns a deterministic salt per market/epoch pair", () => {
    const first = mockOracle("USDC/XLM", 1_720_000_000_000)
    const second = mockOracle("USDC/XLM", 1_720_000_000_000)
    expect(first.salt).toBe(second.salt)
    expect(first.price).toBe(1n)
    expect(first.epoch).toBe(1_720_000_000)
  })

  it("returns a different salt when the market changes", () => {
    const usdc = mockOracle("USDC/XLM", 1_720_000_000_000)
    const yxlm = mockOracle("yXLM/XLM", 1_720_000_000_000)
    expect(usdc.salt).not.toBe(yxlm.salt)
  })
})

describe("fieldFromString", () => {
  it("produces the same value for equal inputs", () => {
    expect(fieldFromString("USDC/XLM")).toBe(fieldFromString("USDC/XLM"))
  })

  it("produces different values for different inputs", () => {
    expect(fieldFromString("USDC/XLM")).not.toBe(fieldFromString("yXLM/XLM"))
  })

  it("stays under 32 bytes so it fits every BLS12-381 Fr element", () => {
    const value = fieldFromString("some/very/long/domain/string:" + "x".repeat(500))
    // 0x + 62 hex chars = 31 bytes.
    expect(value.length).toBe(2 + 62)
  })
})
