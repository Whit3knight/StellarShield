import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { BorrowEligibilityProof } from "@/features/proofs"

import { __TEST__, borrowSession } from "./session-store"
import type { BorrowActivity, UserPosition } from "./types"

beforeEach(() => {
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
  borrowSession.reset()
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
})

function activity(seed: string): BorrowActivity {
  return {
    description: seed,
    id: `activity-${seed}`,
    status: "completed",
    timestamp: "2026-07-09T00:00:00.000Z",
    title: seed,
    type: "proof_generated",
  }
}

function proof(id: string): BorrowEligibilityProof {
  return {
    claim: "Borrow eligibility verified",
    expiresAt: "2026-07-09T00:10:00.000Z",
    id,
    publicInputs: {
      healthFactorMin: "1.25",
      market: "USDC/XLM",
      maxLtv: "63%",
    },
    status: "Verified",
  }
}

function position(seed: string): UserPosition {
  return {
    borrowed: [{ amount: 50, symbol: "USDC", valueUsd: 50 }],
    borrowApr: "7.4%",
    borrowingPowerUsed: 0.5,
    healthFactor: 1.9,
    id: `position-${seed}`,
    market: "USDC/XLM",
    nextPaymentDue: "2026-08-08T00:00:00.000Z",
    openedAt: "2026-07-09T00:00:00.000Z",
    receiptHash: "3f6d...91b2",
    status: "Open",
    supplied: [{ amount: 1000, symbol: "XLM", valueUsd: 120 }],
  }
}

afterEach(() => {
  borrowSession.reset()
})

describe("borrowSession", () => {
  it("appends activities newest-first", () => {
    borrowSession.appendActivity(activity("first"))
    borrowSession.appendActivity(activity("second"))

    expect(
      borrowSession.getSnapshot().activities.map((item) => item.title)
    ).toEqual(["second", "first"])
  })

  it("dedupes activities by id", () => {
    const same = activity("same")

    borrowSession.appendActivity(same)
    borrowSession.appendActivity(same)

    expect(borrowSession.getSnapshot().activities).toHaveLength(1)
  })

  it("appends proofs newest-first", () => {
    borrowSession.appendProof(proof("p1"))
    borrowSession.appendProof(proof("p2"))

    expect(borrowSession.getSnapshot().proofs.map((item) => item.id)).toEqual([
      "p2",
      "p1",
    ])
  })

  it("dedupes proofs by id", () => {
    borrowSession.appendProof(proof("p1"))
    borrowSession.appendProof(proof("p1"))

    expect(borrowSession.getSnapshot().proofs).toHaveLength(1)
  })

  it("notifies subscribers on new activity", () => {
    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    borrowSession.appendActivity(activity("one"))

    expect(calls).toBe(1)

    unsubscribe()
  })

  it("skips notify when appended activity is a duplicate", () => {
    const same = activity("dup")
    borrowSession.appendActivity(same)

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    borrowSession.appendActivity(same)

    expect(calls).toBe(0)

    unsubscribe()
  })

  it("persists appended state to localStorage", () => {
    borrowSession.appendActivity(activity("persisted"))

    const raw = window.localStorage.getItem(__TEST__.STORAGE_KEY)

    expect(raw).not.toBeNull()
    if (raw) {
      const parsed = JSON.parse(raw) as {
        activities: BorrowActivity[]
        proofs: BorrowEligibilityProof[]
      }
      expect(parsed.activities.map((item) => item.title)).toEqual([
        "persisted",
      ])
    }
  })

  it("drops malformed JSON on external write and rehydrates empty", () => {
    window.localStorage.setItem(__TEST__.STORAGE_KEY, "{{{ not json")

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(borrowSession.getSnapshot().activities).toHaveLength(0)
    expect(borrowSession.getSnapshot().proofs).toHaveLength(0)
    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBeNull()
    expect(calls).toBe(1)

    unsubscribe()
  })

  it("re-reads from localStorage on external change event", () => {
    borrowSession.appendActivity(activity("first"))

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    const externalState = {
      activities: [activity("external")],
      proofs: [],
    }
    window.localStorage.setItem(
      __TEST__.STORAGE_KEY,
      JSON.stringify(externalState)
    )
    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(
      borrowSession.getSnapshot().activities.map((item) => item.title)
    ).toEqual(["external"])
    expect(calls).toBe(1)

    unsubscribe()
  })

  it("appends positions newest-first and dedupes by id", () => {
    borrowSession.appendPosition(position("a"))
    borrowSession.appendPosition(position("b"))
    borrowSession.appendPosition(position("a"))

    expect(
      borrowSession.getSnapshot().positions.map((item) => item.id)
    ).toEqual(["position-b", "position-a"])
  })

  it("hydrates legacy payloads without positions to an empty array", () => {
    window.localStorage.setItem(
      __TEST__.STORAGE_KEY,
      JSON.stringify({
        activities: [activity("legacy")],
        proofs: [],
      })
    )

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(borrowSession.getSnapshot().positions).toEqual([])
    expect(
      borrowSession.getSnapshot().activities.map((item) => item.title)
    ).toEqual(["legacy"])
    expect(calls).toBe(1)

    unsubscribe()
  })
})
