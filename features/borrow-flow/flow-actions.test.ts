import { describe, expect, it } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { marketCards } from "@/features/markets"

import {
  canSubmitTransaction,
  createBorrowIntentFromFlow,
  generateProof,
  simulateBorrowIntentFromFlow,
} from "./flow-actions"
import { getBorrowFlowMetrics } from "./quote"
import type { BorrowFlowMetrics, BorrowProof, Transaction } from "./types"

const account: ConnectedAccount = {
  wallet: {
    address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
    balance: "9,999.99998 XLM",
    balances: { XLM: "9,999.99998 XLM" },
    providerId: "freighter",
    providerName: "Freighter",
    shortAddress: "GDU3...Y9KQ",
  },
}

const market = marketCards[0]

function validMetrics(): BorrowFlowMetrics {
  return getBorrowFlowMetrics(
    { collateralAmount: "3000", loanAmount: "200" },
    market,
    account
  )
}

function invalidMetrics(): BorrowFlowMetrics {
  return getBorrowFlowMetrics(
    { collateralAmount: "3000", loanAmount: "10000" },
    market,
    account
  )
}

async function makeProof(
  metrics: BorrowFlowMetrics
): Promise<BorrowProof> {
  const result = await generateProof({ account, market, metrics })
  if (!result.ok) throw new Error("proof failed")
  return result.value
}

describe("canSubmitTransaction", () => {
  it("returns true when Verified + valid + Ready", () => {
    const metrics = validMetrics()

    expect(
      canSubmitTransaction({
        metrics,
        status: "Verified",
        transaction: {
          status: "Ready",
          intent: { id: "i" } as never,
          payload: { id: "p" } as never,
        },
      })
    ).toBe(true)
  })

  it("returns false when verification not Verified", () => {
    const metrics = validMetrics()

    expect(
      canSubmitTransaction({
        metrics,
        status: "Preparing",
        transaction: {
          status: "Ready",
          intent: { id: "i" } as never,
          payload: { id: "p" } as never,
        },
      })
    ).toBe(false)
  })

  it("returns false when transaction not Ready", () => {
    const metrics = validMetrics()

    expect(
      canSubmitTransaction({
        metrics,
        status: "Verified",
        transaction: { status: "Draft" } satisfies Transaction,
      })
    ).toBe(false)
  })

  it("returns false when loan is invalid", () => {
    const metrics = invalidMetrics()

    expect(
      canSubmitTransaction({
        metrics,
        status: "Verified",
        transaction: {
          status: "Ready",
          intent: { id: "i" } as never,
          payload: { id: "p" } as never,
        },
      })
    ).toBe(false)
  })
})

describe("createBorrowIntentFromFlow", () => {
  it("returns null when account is missing", async () => {
    const metrics = validMetrics()
    const proof = await makeProof(metrics)

    const result = await createBorrowIntentFromFlow({
      account: null,
      metrics,
      proof,
    })

    expect(result).toEqual({ ok: true, value: null })
  })

  it("returns null when proof is missing", async () => {
    const metrics = validMetrics()

    const result = await createBorrowIntentFromFlow({
      account,
      metrics,
      proof: null,
    })

    expect(result).toEqual({ ok: true, value: null })
  })

  it("returns null when proof is not Verified", async () => {
    const metrics = validMetrics()
    const proof = await makeProof(metrics)

    const result = await createBorrowIntentFromFlow({
      account,
      metrics,
      proof: { ...proof, status: "Failed" },
    })

    expect(result).toEqual({ ok: true, value: null })
  })

  it("returns null when loan is invalid", async () => {
    const metrics = invalidMetrics()
    const proof = await makeProof(metrics)

    const result = await createBorrowIntentFromFlow({
      account,
      metrics,
      proof: { ...proof, status: "Verified" },
    })

    expect(result).toEqual({ ok: true, value: null })
  })

  it("builds an intent bound to the proof id when preconditions hold", async () => {
    const metrics = validMetrics()
    const proof = await makeProof(metrics)

    const result = await createBorrowIntentFromFlow({
      account,
      metrics,
      proof,
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.value) {
      expect(result.value.proofId).toBe(proof.id)
      expect(result.value.market).toBe(metrics.quote.market)
    }
  })
})

describe("simulateBorrowIntentFromFlow", () => {
  it("returns InvalidInput when intent is null", async () => {
    const metrics = validMetrics()

    const result = await simulateBorrowIntentFromFlow({
      intent: null,
      metrics,
    })

    expect(result).toEqual({
      ok: false,
      error: {
        tag: "InvalidInput",
        field: "intent",
        message: "Borrow intent is required before simulation.",
      },
    })
  })
})
