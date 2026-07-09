import { afterEach, describe, expect, it, vi } from "vitest"

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

  it("surfaces the contract id in simulateBorrow's not-implemented message", async () => {
    const intentResult = await adapter.createBorrowIntent(intentParams)
    if (!intentResult.ok) throw new Error("intent build failed")
    const intent = intentResult.value

    const sim = await adapter.simulateBorrow({
      fee: {
        amount: 0.00003,
        symbol: "XLM",
        valueUsd: 0.0000036,
      },
      intent,
    })

    expect(sim.ok).toBe(false)
    if (!sim.ok) {
      expect(sim.error.tag).toBe("Unknown")
      if (sim.error.tag === "Unknown") {
        expect(sim.error.message).toContain(config.contractId)
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

const readyPayload = {
  expiresAt: "2026-07-09T00:05:00.000Z",
  fee: { amount: 0.00003, symbol: "XLM" as const, valueUsd: 0.0000036 },
  id: "tx-test",
  intentId: "intent-test",
  memo: "test",
  network: "stellar-testnet" as const,
  operation: "borrow" as const,
  status: "Ready" as const,
}

async function mockSdkAndReimport({
  sendResponse,
  getTransactionResponses,
}: {
  getTransactionResponses?: Array<{
    status: "SUCCESS" | "FAILED" | "NOT_FOUND"
    createdAt?: number
  }>
  sendResponse?: {
    status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR"
    hash: string
    errorResultXdr?: string
  }
}) {
  const send = vi.fn(async () => sendResponse)
  const getTxQueue = [...(getTransactionResponses ?? [])]
  const getTx = vi.fn(async () => {
    return (
      getTxQueue.shift() ?? {
        status: "NOT_FOUND" as const,
      }
    )
  })

  return {
    send,
    getTx,
    adapter: createSorobanProtocolAdapter(config, {
      rpcClient: {
        sendTransaction: send as unknown as (input: {
          networkPassphrase: string
          signedXdr: string
        }) => Promise<never>,
        getTransaction: getTx as unknown as (
          hash: string
        ) => Promise<never>,
      },
    }),
  }
}

describe("sorobanProtocolAdapter.submitTransaction", () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it("returns Submitted + hash on PENDING", async () => {
    const { adapter } = await mockSdkAndReimport({
      sendResponse: { status: "PENDING", hash: "H1" },
    })

    const result = await adapter.submitTransaction({
      payload: readyPayload,
      signedXdr: "SIGNED",
    })

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        hash: "H1",
        status: "Submitted",
      }),
    })
  })

  it("returns Submitted on DUPLICATE", async () => {
    const { adapter } = await mockSdkAndReimport({
      sendResponse: { status: "DUPLICATE", hash: "H2" },
    })

    const result = await adapter.submitTransaction({
      payload: readyPayload,
      signedXdr: "SIGNED",
    })

    expect(result.ok).toBe(true)
  })

  it("maps TRY_AGAIN_LATER to Network(retriable)", async () => {
    const { adapter } = await mockSdkAndReimport({
      sendResponse: { status: "TRY_AGAIN_LATER", hash: "H3" },
    })

    const result = await adapter.submitTransaction({
      payload: readyPayload,
      signedXdr: "SIGNED",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("Network")
      if (result.error.tag === "Network") {
        expect(result.error.retriable).toBe(true)
      }
    }
  })

  it("maps ERROR to TransactionFailed with resultCode", async () => {
    const { adapter } = await mockSdkAndReimport({
      sendResponse: {
        status: "ERROR",
        hash: "H4",
        errorResultXdr: "AAAAAAerr",
      },
    })

    const result = await adapter.submitTransaction({
      payload: readyPayload,
      signedXdr: "SIGNED",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("TransactionFailed")
      if (result.error.tag === "TransactionFailed") {
        expect(result.error.hash).toBe("H4")
        expect(result.error.resultCode).toBe("AAAAAAerr")
      }
    }
  })

  it("returns InvalidInput when signedXdr is empty", async () => {
    const result = await adapter.submitTransaction({
      payload: readyPayload,
      signedXdr: "",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.tag).toBe("InvalidInput")
  })
})

describe("sorobanProtocolAdapter.waitForConfirmation", () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it("returns receipt on SUCCESS", async () => {
    const { adapter } = await mockSdkAndReimport({
      getTransactionResponses: [
        { status: "SUCCESS", createdAt: 1_720_000_000 },
      ],
    })

    const result = await adapter.waitForConfirmation({
      payload: { ...readyPayload, hash: "HASH_OK" },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.hash).toBe("HASH_OK")
      expect(result.value.confirmedAt).toBe(
        new Date(1_720_000_000_000).toISOString()
      )
    }
  })

  it("returns TransactionFailed on FAILED", async () => {
    const { adapter } = await mockSdkAndReimport({
      getTransactionResponses: [{ status: "FAILED", createdAt: 1_720_000_000 }],
    })

    const result = await adapter.waitForConfirmation({
      payload: { ...readyPayload, hash: "HASH_FAIL" },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("TransactionFailed")
      if (result.error.tag === "TransactionFailed") {
        expect(result.error.hash).toBe("HASH_FAIL")
      }
    }
  })

  it("returns InvalidInput when payload.hash is missing", async () => {
    const result = await adapter.waitForConfirmation({
      payload: readyPayload,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("InvalidInput")
      if (result.error.tag === "InvalidInput") {
        expect(result.error.field).toBe("payload.hash")
      }
    }
  })
})
