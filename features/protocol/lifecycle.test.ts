import { describe, expect, it } from "vitest"

import {
  assertTransition,
  canTransition,
  isTerminal,
  type LifecycleState,
} from "./lifecycle"

describe("lifecycle state machine", () => {
  it("marks the expected terminal states", () => {
    const terminals: LifecycleState[] = [
      "Confirmed",
      "Failed",
      "Expired",
      "Rejected",
      "Aborted",
    ]

    for (const state of terminals) {
      expect(isTerminal(state)).toBe(true)
    }
  })

  it("does not mark non-terminal states", () => {
    const nonTerminals: LifecycleState[] = [
      "Idle",
      "Quoting",
      "Proving",
      "Ready",
      "Signing",
    ]

    for (const state of nonTerminals) {
      expect(isTerminal(state)).toBe(false)
    }
  })

  it("allows the happy path", () => {
    const happy: LifecycleState[] = [
      "Idle",
      "Quoting",
      "Proving",
      "ProofReady",
      "IntentPending",
      "Simulating",
      "Ready",
      "Signing",
      "Submitted",
      "Confirmed",
    ]

    for (let i = 0; i < happy.length - 1; i += 1) {
      expect(canTransition(happy[i], happy[i + 1])).toBe(true)
    }
  })

  it("rejects illegal transitions", () => {
    expect(canTransition("Idle", "Signing")).toBe(false)
    expect(canTransition("Ready", "Confirmed")).toBe(false)
    expect(canTransition("Confirmed", "Signing")).toBe(false)
  })

  it("allows recovery from terminal states via Idle only", () => {
    expect(canTransition("Confirmed", "Idle")).toBe(true)
    expect(canTransition("Failed", "Idle")).toBe(true)
    expect(canTransition("Aborted", "Idle")).toBe(true)
    expect(canTransition("Failed", "Ready")).toBe(false)
  })

  it("assertTransition throws on illegal transition", () => {
    expect(() => assertTransition("Idle", "Confirmed")).toThrow(
      /Illegal lifecycle transition/
    )
  })

  it("assertTransition returns void on legal transition", () => {
    expect(assertTransition("Idle", "Quoting")).toBeUndefined()
  })
})
