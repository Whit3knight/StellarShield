import { describe, expect, it } from "vitest"

import { computeNullifier } from "./note"
import { eventOpenedAt, filterSpentNotes } from "./scanner"

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

describe("filterSpentNotes", () => {
  const sk = 42n

  it("keeps notes whose nullifiers are not in the spent set", () => {
    const notes = [
      { sk, index: 0 },
      { sk, index: 1 },
      { sk, index: 2 },
    ]
    const spent = new Set<bigint>([computeNullifier(sk, 1)])
    const result = filterSpentNotes(notes, spent)
    expect(result.map((n) => n.index)).toEqual([0, 2])
  })

  it("returns everything when the spent set is empty", () => {
    const notes = [
      { sk, index: 0 },
      { sk, index: 1 },
    ]
    expect(filterSpentNotes(notes, new Set())).toEqual(notes)
  })

  it("drops everything when every nullifier is spent", () => {
    const notes = [
      { sk, index: 0 },
      { sk, index: 1 },
    ]
    const spent = new Set<bigint>([
      computeNullifier(sk, 0),
      computeNullifier(sk, 1),
    ])
    expect(filterSpentNotes(notes, spent)).toEqual([])
  })

  it("distinguishes nullifiers across different sk", () => {
    const spentForFortyTwo = new Set<bigint>([computeNullifier(42n, 5)])
    const notes = [
      { sk: 42n, index: 5 },
      { sk: 99n, index: 5 },
    ]
    const result = filterSpentNotes(notes, spentForFortyTwo)
    expect(result).toEqual([{ sk: 99n, index: 5 }])
  })
})
