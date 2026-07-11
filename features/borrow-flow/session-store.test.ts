import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { BorrowEligibilityProof } from "@/features/proofs"

import { __TEST__, borrowSession } from "./session-store"

beforeEach(() => {
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
  borrowSession.reset()
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
})

function proof(id: string): BorrowEligibilityProof {
  return {
    claim: "Borrow eligibility verified",
    expiresAt: "2026-07-09T00:10:00.000Z",
    generatedAt: "2026-07-09T00:00:00.000Z",
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

  it("notifies subscribers on new proof", () => {
    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    borrowSession.appendProof(proof("one"))

    expect(calls).toBe(1)
    unsubscribe()
  })

  it("skips notify when appended proof is a duplicate", () => {
    borrowSession.appendProof(proof("dup"))

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    borrowSession.appendProof(proof("dup"))

    expect(calls).toBe(0)
    unsubscribe()
  })

  it("persists appended state to localStorage", () => {
    borrowSession.appendProof(proof("persisted"))

    const raw = window.localStorage.getItem(__TEST__.STORAGE_KEY)
    expect(raw).not.toBeNull()
    if (raw) {
      const parsed = JSON.parse(raw) as { proofs: BorrowEligibilityProof[] }
      expect(parsed.proofs.map((item) => item.id)).toEqual(["persisted"])
    }
  })

  it("drops malformed JSON on external write and rehydrates empty", () => {
    window.localStorage.setItem(__TEST__.STORAGE_KEY, "{{{ not json")

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(borrowSession.getSnapshot().proofs).toHaveLength(0)
    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBeNull()
    expect(calls).toBe(1)
    unsubscribe()
  })

  it("re-reads from localStorage on external change event", () => {
    borrowSession.appendProof(proof("first"))

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    const externalState = { proofs: [proof("external")] }
    window.localStorage.setItem(
      __TEST__.STORAGE_KEY,
      JSON.stringify(externalState)
    )
    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(
      borrowSession.getSnapshot().proofs.map((item) => item.id)
    ).toEqual(["external"])
    expect(calls).toBe(1)
    unsubscribe()
  })

  it("caps proofs at PROOF_HISTORY_CAP and drops oldest", () => {
    for (let index = 0; index < __TEST__.PROOF_HISTORY_CAP + 5; index++) {
      borrowSession.appendProof(proof(`p-${index}`))
    }

    const proofs = borrowSession.getSnapshot().proofs
    expect(proofs).toHaveLength(__TEST__.PROOF_HISTORY_CAP)
    expect(proofs[0]?.id).toBe(`p-${__TEST__.PROOF_HISTORY_CAP + 4}`)
    expect(proofs[proofs.length - 1]?.id).toBe("p-5")
  })

  it("reset clears state, wipes storage, and notifies subscribers", () => {
    borrowSession.appendProof(proof("before-reset"))

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    borrowSession.reset()

    const snapshot = borrowSession.getSnapshot()
    expect(snapshot.proofs).toEqual([])
    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBe(
      JSON.stringify({ proofs: [] })
    )
    expect(calls).toBe(1)
    unsubscribe()
  })

  it("ignores storage events for unrelated keys", () => {
    borrowSession.appendProof(proof("keep"))

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    const event = new StorageEvent("storage", { key: "unrelated-key" })
    window.dispatchEvent(event)

    expect(borrowSession.getSnapshot().proofs.map((item) => item.id)).toEqual([
      "keep",
    ])
    expect(calls).toBe(0)
    unsubscribe()
  })

  it("hydrates legacy payloads with activities/positions to proofs-only state", () => {
    window.localStorage.setItem(
      __TEST__.STORAGE_KEY,
      JSON.stringify({
        activities: [{ id: "old", title: "legacy" }],
        positions: [{ id: "old-pos" }],
        proofs: [proof("kept")],
      })
    )

    let calls = 0
    const unsubscribe = borrowSession.subscribe(() => calls++)

    window.dispatchEvent(new Event(__TEST__.CHANGE_EVENT))

    expect(borrowSession.getSnapshot().proofs.map((item) => item.id)).toEqual([
      "kept",
    ])
    expect(calls).toBe(1)
    unsubscribe()
  })
})
