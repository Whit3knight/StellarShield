import { beforeEach, describe, expect, it } from "vitest"

import type { ShieldedNote } from "./note"
import {
  configureNotePersistence,
  replaceNotes,
  snapshotLiveNotes,
  snapshotNotes,
  upsertNote,
} from "./note-store"

const CONTRACT = "CCONTRACT"

const NOTE: ShieldedNote = {
  amount: 100n,
  asset: "XLM",
  index: 0,
  salt: 12345n,
  sk: 7n,
  tree: "deposit",
  witness: {
    pathElements: [1n, 2n],
    pathBits: [0, 1],
    root: 99n,
  },
}

let accountSeq = 0
const freshAccount = () => `GACC${accountSeq++}`

describe("note persistence", () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Point the store at a fresh (empty) slot so tests don't share state.
    configureNotePersistence(CONTRACT, freshAccount())
  })

  it("round-trips notes across a re-configure, stripping witnesses", () => {
    const account = freshAccount()
    configureNotePersistence(CONTRACT, account)
    upsertNote(NOTE)
    upsertNote({ ...NOTE, index: 1, spent: true, witness: undefined })

    // Switch away, then back — hydration must come from localStorage.
    configureNotePersistence(CONTRACT, freshAccount())
    expect(snapshotNotes()).toEqual([])
    configureNotePersistence(CONTRACT, account)

    const restored = snapshotNotes()
    expect(restored).toHaveLength(2)
    const byIndex = new Map(restored.map((n) => [n.index, n]))
    expect(byIndex.get(0)).toMatchObject({
      amount: 100n,
      asset: "XLM",
      salt: 12345n,
      sk: 7n,
      tree: "deposit",
    })
    expect(byIndex.get(0)?.witness).toBeUndefined()
    expect(byIndex.get(1)?.spent).toBe(true)
  })

  it("re-configuring with the same key is a no-op (keeps in-memory witnesses)", () => {
    const account = freshAccount()
    configureNotePersistence(CONTRACT, account)
    upsertNote(NOTE)
    configureNotePersistence(CONTRACT, account)
    expect(snapshotNotes()[0].witness).toBeDefined()
  })

  it("survives corrupted storage", () => {
    const account = freshAccount()
    window.localStorage.setItem(
      `stellar-shield:notes:v1:${CONTRACT}:${account}`,
      "not json"
    )
    configureNotePersistence(CONTRACT, account)
    expect(snapshotNotes()).toEqual([])
  })
})

describe("snapshotLiveNotes", () => {
  beforeEach(() => {
    window.localStorage.clear()
    configureNotePersistence(CONTRACT, freshAccount())
  })

  it("filters spent tombstones and legacy zero-amount notes", () => {
    replaceNotes([
      { ...NOTE, index: 0 },
      { ...NOTE, index: 1, spent: true },
      { ...NOTE, index: 2, amount: 0n },
    ])
    expect(snapshotLiveNotes().map((n) => n.index)).toEqual([0])
  })

  it("returns a stable reference until the cache changes", () => {
    replaceNotes([NOTE])
    const first = snapshotLiveNotes()
    expect(snapshotLiveNotes()).toBe(first)
    upsertNote({ ...NOTE, index: 5 })
    expect(snapshotLiveNotes()).not.toBe(first)
  })
})
