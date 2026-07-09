import { describe, expect, it } from "vitest"

import { mockProtocolAdapter } from "./mock-adapter"

const intentParams = {
  account: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
  borrow: {
    amount: 50,
    symbol: "USDC" as const,
    valueUsd: 50,
  },
  collateral: {
    amount: 1000,
    symbol: "XLM" as const,
    valueUsd: 120,
  },
  expiresAt: "2026-07-09T00:10:00.000Z",
  healthFactor: 1.92,
  market: "USDC/XLM",
  maxLtv: 0.625,
  proofId: "proof-abc",
}

const fee = {
  amount: 0.00003,
  symbol: "XLM" as const,
  valueUsd: 0.0000036,
}

describe("protocol mock adapter", () => {
  it("creates deterministic borrow intents", async () => {
    const result = await mockProtocolAdapter.createBorrowIntent(intentParams)

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        account: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
        id: "intent-0tt2nhm",
        market: "USDC/XLM",
        proofId: "proof-abc",
      }),
    })
  })

  it("simulates ready transaction payloads", async () => {
    const intentResult = await mockProtocolAdapter.createBorrowIntent(
      intentParams
    )
    if (!intentResult.ok) throw new Error("intent failed")

    const result = await mockProtocolAdapter.simulateBorrow({
      fee,
      intent: intentResult.value,
      now: Date.UTC(2026, 6, 9),
    })

    expect(result).toEqual({
      ok: true,
      value: {
        expiresAt: "2026-07-09T00:05:00.000Z",
        fee,
        id: "tx-1ycwvdi",
        intentId: "intent-0tt2nhm",
        memo: "StellarShield borrow USDC/XLM",
        network: "stellar-testnet",
        operation: "borrow",
        status: "Ready",
      },
    })
  })

  it("signs, submits, then waits for confirmation", async () => {
    const intentResult = await mockProtocolAdapter.createBorrowIntent(
      intentParams
    )
    if (!intentResult.ok) throw new Error("intent failed")

    const simulation = await mockProtocolAdapter.simulateBorrow({
      fee,
      intent: intentResult.value,
      now: Date.UTC(2026, 6, 9),
    })
    if (!simulation.ok) throw new Error("sim failed")

    const signed = await mockProtocolAdapter.signTransaction({
      account: intentParams.account,
      payload: simulation.value,
    })
    if (!signed.ok) throw new Error("sign failed")
    expect(signed.value.payload.status).toBe("Signing")
    expect(signed.value.signedXdr).toBe(`signed:${simulation.value.id}`)

    const submitted = await mockProtocolAdapter.submitTransaction({
      payload: signed.value.payload,
      signedXdr: signed.value.signedXdr,
    })
    if (!submitted.ok) throw new Error("submit failed")
    expect(submitted.value.status).toBe("Submitted")

    const confirmed = await mockProtocolAdapter.waitForConfirmation({
      payload: submitted.value,
      now: Date.UTC(2026, 6, 9, 0, 1),
    })
    if (!confirmed.ok) throw new Error("confirm failed")
    expect(confirmed.value).toEqual({
      confirmedAt: "2026-07-09T00:01:00.000Z",
      hash: "3f6d...91b2",
      network: "stellar-testnet",
    })
  })

  it("returns Aborted when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await mockProtocolAdapter.createBorrowIntent(
      intentParams,
      controller.signal
    )

    expect(result).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Operation aborted." },
    })
  })
})
