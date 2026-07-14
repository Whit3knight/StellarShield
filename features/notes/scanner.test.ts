import { describe, expect, it } from "vitest"

import { computeNullifier, type ShieldedNote } from "./note"
import {
  carryOverNotes,
  dedupeNotes,
  eventOpenedAt,
  markSpentNotes,
} from "./scanner"

describe("eventOpenedAt", () => {
  it("parses an ISO ledgerClosedAt to unix seconds", () => {
    expect(eventOpenedAt({ ledgerClosedAt: "2026-01-15T12:34:56Z" })).toBe(
      Math.floor(Date.parse("2026-01-15T12:34:56Z") / 1000)
    )
  })

  it("returns undefined for missing timestamp", () => {
    expect(eventOpenedAt({})).toBeUndefined()
  })

  it("returns undefined for unparseable timestamp", () => {
    expect(eventOpenedAt({ ledgerClosedAt: "not-a-date" })).toBeUndefined()
  })
})

describe("markSpentNotes", () => {
  const sk = 42n

  it("tombstones notes whose nullifiers are in the spent set", () => {
    const notes = [
      { sk, index: 0 },
      { sk, index: 1 },
      { sk, index: 2 },
    ]
    const spent = new Set<bigint>([computeNullifier(sk, 1)])
    const result = markSpentNotes(notes, spent)
    expect(result).toHaveLength(3)
    expect(result.map((n) => n.spent === true)).toEqual([false, true, false])
  })

  it("returns notes untouched when the spent set is empty", () => {
    const notes = [
      { sk, index: 0 },
      { sk, index: 1 },
    ]
    expect(markSpentNotes(notes, new Set())).toEqual(notes)
  })

  it("keeps an already-spent note's reference stable", () => {
    const note = { sk, index: 0, spent: true }
    const result = markSpentNotes([note], new Set([computeNullifier(sk, 0)]))
    expect(result[0]).toBe(note)
  })

  it("distinguishes nullifiers across different sk", () => {
    const spentForFortyTwo = new Set<bigint>([computeNullifier(42n, 5)])
    const notes = [
      { sk: 42n, index: 5 },
      { sk: 99n, index: 5 },
    ]
    const result = markSpentNotes(notes, spentForFortyTwo)
    expect(result[0].spent).toBe(true)
    expect(result[1].spent).toBeUndefined()
  })
})

describe("carryOverNotes", () => {
  const base = {
    amount: 100n,
    asset: "XLM" as const,
    salt: 1n,
    sk: 42n,
    tree: "deposit" as const,
  }
  const key = (n: ShieldedNote) => `${n.asset}:${n.tree}:${n.index}`

  it("keeps unseen notes even without a witness", () => {
    const previous: ShieldedNote[] = [{ ...base, index: 0 }]
    const carried = carryOverNotes(previous, new Set(), new Set())
    expect(carried).toEqual(previous)
  })

  it("drops notes the scan already surfaced", () => {
    const previous: ShieldedNote[] = [
      { ...base, index: 0 },
      { ...base, index: 1 },
    ]
    const seen = new Set([key(previous[0])])
    const carried = carryOverNotes(previous, seen, new Set())
    expect(carried.map((n) => n.index)).toEqual([1])
  })

  it("tombstones instead of dropping when the nullifier is spent — both trees", () => {
    const previous: ShieldedNote[] = [
      { ...base, index: 0 },
      { ...base, index: 1, tree: "loan" },
    ]
    const spent = new Set([
      computeNullifier(base.sk, 0),
      computeNullifier(base.sk, 1),
    ])
    const carried = carryOverNotes(previous, new Set(), spent)
    expect(carried.map((n) => n.spent)).toEqual([true, true])
    expect(carried.map((n) => n.amount)).toEqual([100n, 100n])
  })
})

describe("dedupeNotes", () => {
  const base = {
    amount: 100n,
    salt: 1n,
    sk: 42n,
  }

  it("keeps the first sighting of a (asset, tree, index) tuple", () => {
    const notes = [
      { ...base, asset: "XLM" as const, index: 0, tree: "deposit" as const },
      { ...base, asset: "XLM" as const, index: 0, tree: "deposit" as const },
      { ...base, asset: "XLM" as const, index: 1, tree: "deposit" as const },
    ]
    const result = dedupeNotes(notes)
    expect(result).toHaveLength(2)
    expect(result.map((n) => n.index)).toEqual([0, 1])
  })

  it("does not collapse across trees or assets", () => {
    const notes = [
      { ...base, asset: "XLM" as const, index: 0, tree: "deposit" as const },
      { ...base, asset: "XLM" as const, index: 0, tree: "loan" as const },
      { ...base, asset: "USDC" as const, index: 0, tree: "deposit" as const },
    ]
    expect(dedupeNotes(notes)).toHaveLength(3)
  })

  it("is a no-op on empty input", () => {
    expect(dedupeNotes([])).toEqual([])
  })
})
