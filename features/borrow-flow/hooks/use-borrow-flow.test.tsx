import { act, renderHook } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { marketCards } from "@/features/markets"
import {
  err,
  mockProtocolAdapter,
  type AdapterError,
  type ProtocolAdapter,
} from "@/features/protocol"
import type { BorrowProverAdapter } from "@/features/proofs"
import { AdapterProvider } from "@/features/shared/adapter-provider"

import { useBorrowFlow } from "./use-borrow-flow"

function wrapper({ children }: { children: React.ReactNode }) {
  return <AdapterProvider>{children}</AdapterProvider>
}

function makeWrapper({
  protocol,
  prover,
}: {
  protocol?: ProtocolAdapter
  prover?: BorrowProverAdapter
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AdapterProvider protocol={protocol} prover={prover}>
        {children}
      </AdapterProvider>
    )
  }
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
    expect(result.current.flow.transaction.status).toBe("Ready")
    expect(result.current.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining(["proof_generated", "borrow_intent_prepared"])
    )

    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transaction.status).toBe("Confirmed")
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
    expect(result.current.flow.transaction.status).toBe("Draft")
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

    expect(result.current.flow.transaction.status).toBe("Draft")
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

  it("surfaces prover errors as Failed verification with the AdapterError attached", async () => {
    const proverError: AdapterError = {
      tag: "ProofGenerationFailed",
      reason: "boom",
    }
    const prover: BorrowProverAdapter = {
      generateBorrowProof: async () => err(proverError),
    }

    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper: makeWrapper({ prover }) }
    )

    await act(async () => undefined)
    await act(async () => {
      await result.current.verifyEligibility()
    })

    expect(result.current.flow.verification.status).toBe("Failed")
    if (result.current.flow.verification.status === "Failed") {
      expect(result.current.flow.verification.error).toEqual(proverError)
      expect(result.current.flow.verification.proof).toBeNull()
    }
    expect(result.current.flow.transaction.status).toBe("Draft")
    expect(
      result.current.activity.some((item) => item.type === "proof_generated")
    ).toBe(false)
  })

  it("routes sign failure to Failed(UserRejected)", async () => {
    const signError: AdapterError = {
      tag: "UserRejected",
      message: "denied",
    }
    const protocol: ProtocolAdapter = {
      ...mockProtocolAdapter,
      signTransaction: async () => err(signError),
    }

    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper: makeWrapper({ protocol }) }
    )

    await act(async () => undefined)
    await act(async () => {
      await result.current.verifyEligibility()
    })
    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transaction.status).toBe("Failed")
    if (result.current.flow.transaction.status === "Failed") {
      expect(result.current.flow.transaction.error?.tag).toBe("UserRejected")
    }
    expect(
      result.current.activity.some(
        (item) => item.type === "transaction_submitted"
      )
    ).toBe(false)
  })

  it("routes submit failure to Failed(Network)", async () => {
    const submitError: AdapterError = {
      tag: "Network",
      retriable: true,
      message: "rpc",
    }
    const protocol: ProtocolAdapter = {
      ...mockProtocolAdapter,
      submitTransaction: async () => err(submitError),
    }

    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper: makeWrapper({ protocol }) }
    )

    await act(async () => undefined)
    await act(async () => {
      await result.current.verifyEligibility()
    })
    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transaction.status).toBe("Failed")
    if (result.current.flow.transaction.status === "Failed") {
      expect(result.current.flow.transaction.error?.tag).toBe("Network")
    }
  })

  it("auto-precomputes verification 300ms after amounts stabilise", async () => {
    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper }
    )

    await act(async () => undefined)

    expect(result.current.flow.verification.status).toBe("Not started")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(result.current.flow.verification.status).toBe("Verified")
    expect(result.current.flow.transaction.status).toBe("Ready")
  })

  it("does not auto-retry after a failed prover attempt for the same amounts", async () => {
    const attempts: number[] = []
    const prover: BorrowProverAdapter = {
      generateBorrowProof: async () => {
        attempts.push(Date.now())
        return err({ tag: "ProofGenerationFailed", reason: "boom" })
      },
    }

    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper: makeWrapper({ prover }) }
    )

    await act(async () => undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(attempts).toHaveLength(1)
    expect(result.current.flow.verification.status).toBe("Failed")
  })

  it("routes wait failure to Failed(TransactionFailed) after submitted activity", async () => {
    const waitError: AdapterError = {
      tag: "TransactionFailed",
      hash: "abc",
      message: "chain rejected",
    }
    const protocol: ProtocolAdapter = {
      ...mockProtocolAdapter,
      waitForConfirmation: async () => err(waitError),
    }

    const { result } = renderHook(
      () => useBorrowFlow({ account, market: marketCards[0] }),
      { wrapper: makeWrapper({ protocol }) }
    )

    await act(async () => undefined)
    await act(async () => {
      await result.current.verifyEligibility()
    })
    await act(async () => {
      await result.current.submitTransaction()
    })

    expect(result.current.flow.transaction.status).toBe("Failed")
    if (result.current.flow.transaction.status === "Failed") {
      expect(result.current.flow.transaction.error?.tag).toBe(
        "TransactionFailed"
      )
    }
    expect(
      result.current.activity.some(
        (item) => item.type === "transaction_submitted"
      )
    ).toBe(true)
  })
})

