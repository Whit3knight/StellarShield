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
      await result.current.verifyEligibility()
    })

    expect(result.current.flow.verification.status).toBe("Verified")
    expect(result.current.flow.borrowIntent).toBeTruthy()
    expect(result.current.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining(["proof_generated", "borrow_intent_prepared"])
    )

    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transactionStatus).toBe("Confirmed")
    expect(result.current.position).toMatchObject({
      borrowed: [{ amount: 220, symbol: "USDC" }],
      market: "USDC/XLM",
      receiptHash: "3f6d...91b2",
      status: "Open",
      supplied: [{ amount: 3000, symbol: "XLM" }],
    })
    expect(result.current.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "transaction_submitted",
        "transaction_confirmed",
      ])
    )
  })

  it("marks verification failed and records a proof activity when the loan is invalid", async () => {
    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper }
    )

    await act(async () => undefined)
    act(() => {
      result.current.setFieldValue("loanAmount", "10000")
    })

    expect(result.current.metrics.isLoanValid).toBe(false)

    await act(async () => {
      await result.current.verifyEligibility()
    })

    expect(result.current.flow.verification.status).toBe("Failed")
    expect(result.current.flow.borrowIntent).toBeNull()
    expect(result.current.flow.transactionPayload).toBeNull()
    expect(result.current.activity.map((item) => item.type)).toContain(
      "proof_generated"
    )
  })

  it("does nothing when submitTransaction is called before verification", async () => {
    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper }
    )

    await act(async () => undefined)
    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transactionStatus).toBe("Draft")
    expect(
      result.current.activity.some(
        (item) => item.type === "transaction_submitted"
      )
    ).toBe(false)
  })

  it("aborts pending verification on unmount", async () => {
    const { result, unmount } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper }
    )

    await act(async () => undefined)

    let verifyPromise: Promise<void> | undefined
    act(() => {
      verifyPromise = result.current.verifyEligibility()
    })

    unmount()

    await expect(verifyPromise).resolves.not.toThrow()
  })
})
