import { act, renderHook } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { marketCards } from "@/features/markets"
import { AdapterProvider } from "@/features/shared/adapter-provider"

import { useBorrowFlow } from "./use-borrow-flow"

function wrapper({ children }: { children: React.ReactNode }) {
  return <AdapterProvider>{children}</AdapterProvider>
}

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

describe("useBorrowFlow", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-09T00:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("creates proof, intent, activity, and position after confirmation", async () => {
    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper }
    )

    await act(async () => undefined)

    expect(result.current.metrics.isLoanValid).toBe(true)
    expect(result.current.activity[0]).toMatchObject({
      title: "Wallet connected",
      type: "wallet_connected",
    })

    await act(async () => {
      result.current.verifyEligibility()
    })

    await act(async () => {
      vi.advanceTimersByTime(900)
    })

    expect(result.current.flow.verification.status).toBe("Verified")
    expect(result.current.flow.borrowIntent).toBeTruthy()
    expect(result.current.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining(["proof_generated", "borrow_intent_prepared"])
    )

    await act(async () => {
      result.current.submitTransaction()
    })

    expect(result.current.flow.transactionStatus).toBe("Signing")
    expect(result.current.activity[0]).toMatchObject({
      title: "Transaction submitted",
      type: "transaction_submitted",
    })

    await act(async () => {
      result.current.refreshTransaction()
    })
    expect(result.current.flow.transactionStatus).toBe("Submitted")

    await act(async () => {
      result.current.refreshTransaction()
    })
    await act(async () => undefined)

    expect(result.current.flow.transactionStatus).toBe("Confirmed")
    expect(result.current.position).toMatchObject({
      borrowed: [{ amount: 220, symbol: "USDC" }],
      market: "USDC/XLM",
      receiptHash: "3f6d...91b2",
      status: "Open",
      supplied: [{ amount: 3000, symbol: "XLM" }],
    })
    expect(result.current.activity[0]).toMatchObject({
      title: "Transaction confirmed",
      type: "transaction_confirmed",
    })
  })
})
