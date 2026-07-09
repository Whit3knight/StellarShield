import { afterEach, describe, expect, it } from "vitest"

import type { BorrowEligibilityProof } from "@/features/proofs"

import { borrowSession } from "./session-store"
import type { BorrowActivity } from "./types"

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
})
