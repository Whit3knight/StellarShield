import { describe, expect, it, vi } from "vitest"

import { createToastTracker, describeError, isUserRejection } from "./hook-utils"

vi.mock("@/components/ui/toast", () => {
  const closed: unknown[] = []
  return {
    toastManager: {
      close: (id: unknown) => {
        closed.push(id)
      },
      __closed: closed,
    },
    __esModule: true,
  }
})

const { toastManager } = await import("@/components/ui/toast")
const closedLog = (toastManager as unknown as { __closed: unknown[] }).__closed

describe("createToastTracker", () => {
  it("closes the prior toast when a new one is set", () => {
    closedLog.length = 0
    const tracker = createToastTracker()
    tracker.set("a")
    tracker.set("b")
    tracker.set("c")
    expect(closedLog).toEqual(["a", "b"])
  })

  it("close() clears the tracked toast exactly once", () => {
    closedLog.length = 0
    const tracker = createToastTracker()
    tracker.set("x")
    tracker.close()
    tracker.close()
    expect(closedLog).toEqual(["x"])
  })

  it("close() is a no-op when nothing was ever set", () => {
    closedLog.length = 0
    const tracker = createToastTracker()
    tracker.close()
    expect(closedLog).toEqual([])
  })
})

describe("isUserRejection", () => {
  it("matches Freighter cancel variants (case-insensitive)", () => {
    expect(isUserRejection(new Error("User declined access"))).toBe(true)
    expect(isUserRejection(new Error("User Rejected the request"))).toBe(true)
    expect(isUserRejection(new Error("Action canceled"))).toBe(true)
    expect(isUserRejection(new Error("action cancelled by user"))).toBe(true)
    expect(isUserRejection(new Error("not connected"))).toBe(true)
  })

  it("does not match unrelated errors", () => {
    expect(isUserRejection(new Error("Insufficient balance"))).toBe(false)
    expect(isUserRejection(new Error("Network timeout"))).toBe(false)
    expect(isUserRejection(new Error(""))).toBe(false)
    expect(isUserRejection(null)).toBe(false)
    expect(isUserRejection("Deposit failed")).toBe(false)
  })
})

describe("describeError", () => {
  it("collapses user rejection to a neutral message", () => {
    const result = describeError(
      new Error("User declined access"),
      "Borrow failed"
    )
    expect(result).toEqual({
      title: "Signing cancelled",
      description: "You dismissed the wallet prompt.",
      rejected: true,
    })
  })

  it("passes through a real error message", () => {
    const result = describeError(new Error("Contract error #11"), "Borrow failed")
    expect(result.title).toBe("Borrow failed")
    expect(result.description).toBe("Contract error #11")
    expect(result.rejected).toBe(false)
  })

  it("falls back to the title when the caught value has no message", () => {
    const result = describeError(undefined, "Repay failed")
    expect(result.description).toBe("Repay failed.")
    expect(result.rejected).toBe(false)
  })
})
