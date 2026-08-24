import { describe, expect, it } from "vitest"

import {
  deserializeActivity,
  mergeActivities,
  serializeActivity,
  type ShieldedActivity,
} from "./activity"

const activity = (
  overrides: Partial<ShieldedActivity> = {}
): ShieldedActivity => ({
  amount: 10_000_000n,
  asset: "XLM",
  id: "deposit-1",
  timestamp: 1_000,
  type: "deposit",
  ...overrides,
})

describe("mergeActivities", () => {
  it("dedupes by id, preferring the fresh copy over the previous one", () => {
    const previous = [activity({ id: "a", timestamp: 1 })]
    const fresh = [activity({ id: "a", timestamp: 1, amount: 99n })]
    const merged = mergeActivities(previous, fresh)
    expect(merged).toHaveLength(1)
    expect(merged[0].amount).toBe(99n)
  })

  it("unions previous and fresh activity that don't overlap", () => {
    const previous = [activity({ id: "old", timestamp: 1 })]
    const fresh = [activity({ id: "new", timestamp: 2 })]
    const merged = mergeActivities(previous, fresh)
    expect(merged.map((a) => a.id)).toEqual(["new", "old"])
  })

  it("sorts newest first", () => {
    const merged = mergeActivities(
      [],
      [
        activity({ id: "a", timestamp: 5 }),
        activity({ id: "b", timestamp: 20 }),
        activity({ id: "c", timestamp: 10 }),
      ]
    )
    expect(merged.map((a) => a.id)).toEqual(["b", "c", "a"])
  })

  it("puts activity with no timestamp last", () => {
    const merged = mergeActivities(
      [],
      [
        activity({ id: "known", timestamp: 5 }),
        activity({ id: "unknown", timestamp: undefined }),
      ]
    )
    expect(merged.map((a) => a.id)).toEqual(["known", "unknown"])
  })

  it("caps at 100, keeping the newest", () => {
    const fresh = Array.from({ length: 120 }, (_, i) =>
      activity({ id: `id-${i}`, timestamp: i })
    )
    const merged = mergeActivities([], fresh)
    expect(merged).toHaveLength(100)
    expect(merged[0].id).toBe("id-119")
    expect(merged.at(-1)?.id).toBe("id-20")
  })
})

describe("serializeActivity / deserializeActivity", () => {
  it("round-trips every field, including a bigint amount", () => {
    const original = activity({ txHash: "abcd1234" })
    const restored = deserializeActivity(serializeActivity(original))
    expect(restored).toEqual(original)
  })

  it("round-trips an activity with no amount (repay/liquidate)", () => {
    const original = activity({ amount: undefined, type: "repay" })
    const restored = deserializeActivity(serializeActivity(original))
    expect(restored).toEqual(original)
  })

  it("rejects an unknown asset rather than guessing", () => {
    const restored = deserializeActivity({
      asset: "BTC",
      id: "x",
      type: "deposit",
    })
    expect(restored).toBeNull()
  })

  it("rejects an unknown activity type rather than guessing", () => {
    const restored = deserializeActivity({
      asset: "XLM",
      id: "x",
      type: "teleport",
    })
    expect(restored).toBeNull()
  })
})
