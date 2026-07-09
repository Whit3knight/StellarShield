import { describe, expect, it } from "vitest"

import { createSorobanProtocolAdapter } from "./soroban-adapter"

const config = {
  contractId: "CBFAKE_CONTRACT_ID_FOR_TESTS",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
}

const intentParams = {
  account: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
  borrow: { amount: 50, symbol: "USDC" as const, valueUsd: 50 },
  collateral: { amount: 1000, symbol: "XLM" as const, valueUsd: 120 },
  expiresAt: "2026-07-09T00:10:00.000Z",
  healthFactor: 1.92,
  market: "USDC/XLM",
  maxLtv: 0.625,
  proofId: "proof-abc",
}

const adapter = createSorobanProtocolAdapter(config)

describe("sorobanProtocolAdapter", () => {
  it("creates deterministic borrow intents (pure client-side)", async () => {
    const first = await adapter.createBorrowIntent(intentParams)
    const second = await adapter.createBorrowIntent(intentParams)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.value.id).toBe(second.value.id)
      expect(first.value.market).toBe("USDC/XLM")
      expect(first.value.proofId).toBe("proof-abc")
    }
  })

  it("returns Aborted for createBorrowIntent when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await adapter.createBorrowIntent(
      intentParams,
      controller.signal
    )

    expect(result).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Operation aborted." },
    })
  })

  it("surfaces the contract id for still-pending methods", async () => {
    const payload = {
      expiresAt: "2026-07-09T00:05:00.000Z",
      fee: { amount: 0.00003, symbol: "XLM" as const, valueUsd: 0.0000036 },
      id: "tx-test",
      intentId: "intent-test",
      memo: "test",
      network: "stellar-testnet" as const,
      operation: "borrow" as const,
      status: "Ready" as const,
    }
    const intentResult = await adapter.createBorrowIntent(intentParams)
    if (!intentResult.ok) throw new Error("intent build failed")
    const intent = intentResult.value

    const sim = await adapter.simulateBorrow({
      fee: payload.fee,
      intent,
    })
    const submit = await adapter.submitTransaction({
      payload,
      signedXdr: "signed",
    })
    const wait = await adapter.waitForConfirmation({ payload })

    for (const result of [sim, submit, wait]) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.tag).toBe("Unknown")
        if (result.error.tag === "Unknown") {
          expect(result.error.message).toContain(config.contractId)
        }
      }
    }
  })

  it("signTransaction rejects with InvalidInput when preparedXdr is missing", async () => {
    const payload = {
      expiresAt: "2026-07-09T00:05:00.000Z",
      fee: { amount: 0.00003, symbol: "XLM" as const, valueUsd: 0.0000036 },
      id: "tx-test",
      intentId: "intent-test",
      memo: "test",
      network: "stellar-testnet" as const,
      operation: "borrow" as const,
      status: "Ready" as const,
    }

    const result = await adapter.signTransaction({
      account: intentParams.account,
      payload,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("InvalidInput")
      if (result.error.tag === "InvalidInput") {
        expect(result.error.field).toBe("payload.preparedXdr")
      }
    }
  })

  it("returns Aborted before touching the placeholder path", async () => {
    const controller = new AbortController()
    controller.abort()
    const payload = {
      expiresAt: "2026-07-09T00:05:00.000Z",
      fee: { amount: 0.00003, symbol: "XLM" as const, valueUsd: 0.0000036 },
      id: "tx-test",
      intentId: "intent-test",
      memo: "test",
      network: "stellar-testnet" as const,
      operation: "borrow" as const,
      status: "Ready" as const,
    }
    const intentResult = await adapter.createBorrowIntent(intentParams)
    if (!intentResult.ok) throw new Error("intent build failed")

    const sim = await adapter.simulateBorrow(
      { fee: payload.fee, intent: intentResult.value },
      controller.signal
    )

    expect(sim).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Operation aborted." },
    })
  })
})
