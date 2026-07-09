import { describe, expect, it } from "vitest"

import {
  createBorrowIntent,
  getNextSubmitStatus,
  refreshTransaction,
  simulateBorrowIntent,
  submitTransaction,
} from "."

const intent = createBorrowIntent({
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
  expiresAt: "2026-07-09T00:10:00.000Z",
  healthFactor: 1.92,
  market: "USDC/XLM",
  maxLtv: 0.625,
  proofId: "proof-abc",
})

describe("protocol mock adapter", () => {
  it("creates deterministic borrow intents", () => {
    expect(intent).toMatchObject({
      account: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
      borrow: {
        amount: 50,
        symbol: "USDC",
      },
      collateral: {
        amount: 1000,
        symbol: "XLM",
      },
      id: "intent-0tt2nhm",
      market: "USDC/XLM",
      proofId: "proof-abc",
    })
  })

  it("simulates ready transaction payloads", () => {
    expect(
      simulateBorrowIntent({
        fee: {
          amount: 0.00003,
          symbol: "XLM",
          valueUsd: 0.0000036,
        },
        intent,
        now: Date.UTC(2026, 6, 9),
      })
    ).toEqual({
      error: null,
      payload: {
        expiresAt: "2026-07-09T00:05:00.000Z",
        fee: {
          amount: 0.00003,
          symbol: "XLM",
          valueUsd: 0.0000036,
        },
        id: "tx-1ycwvdi",
        intentId: "intent-0tt2nhm",
        memo: "StellarShield borrow USDC/XLM",
        network: "stellar-testnet",
        operation: "borrow",
        status: "Ready",
      },
      status: "Ready",
    })
  })

  it("advances submit state one step at a time", () => {
    expect(getNextSubmitStatus("Ready")).toBe("Ready")
    expect(getNextSubmitStatus("Signing")).toBe("Submitted")
    expect(getNextSubmitStatus("Submitted")).toBe("Confirmed")
    expect(getNextSubmitStatus("Confirmed")).toBe("Confirmed")
  })

  it("submits and refreshes transactions into confirmed receipts", () => {
    const simulation = simulateBorrowIntent({
      fee: {
        amount: 0.00003,
        symbol: "XLM",
        valueUsd: 0.0000036,
      },
      intent,
      now: Date.UTC(2026, 6, 9),
    })
    const signing = submitTransaction({ payload: simulation.payload })
    const submitted = refreshTransaction({ payload: signing.payload })
    const confirmed = refreshTransaction({
      payload: submitted.payload,
      now: Date.UTC(2026, 6, 9, 0, 1),
    })

    expect(signing.status).toBe("Signing")
    expect(submitted.status).toBe("Submitted")
    expect(confirmed).toMatchObject({
      error: null,
      receipt: {
        confirmedAt: "2026-07-09T00:01:00.000Z",
        hash: "3f6d...91b2",
        network: "stellar-testnet",
      },
      status: "Confirmed",
    })
  })
})
