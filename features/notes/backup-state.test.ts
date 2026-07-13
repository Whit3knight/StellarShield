import { afterEach, describe, expect, it } from "vitest"

import { countUnbackedNotes, markBackedUp } from "./backup-state"
import type { ShieldedNote } from "./note"

const ACCOUNT = "GTEST_BACKUP_STATE"

function note(index: number, tree: "deposit" | "loan" = "deposit"): ShieldedNote {
  return { amount: 100n, asset: "XLM", index, salt: 1n, sk: 2n, tree }
}

afterEach(() => {
  window.localStorage.clear()
})

describe("backup-state", () => {
  it("counts every note as unbacked before any export", () => {
    expect(countUnbackedNotes(ACCOUNT, [note(0), note(1)])).toBe(2)
  })

  it("clears the count once notes are marked backed up", () => {
    const notes = [note(0), note(1)]
    markBackedUp(ACCOUNT, notes)
    expect(countUnbackedNotes(ACCOUNT, notes)).toBe(0)
  })

  it("counts only notes added since the last backup", () => {
    markBackedUp(ACCOUNT, [note(0), note(1)])
    expect(countUnbackedNotes(ACCOUNT, [note(0), note(1), note(2)])).toBe(1)
  })

  it("does not resurface a note that was spent after backup", () => {
    // Fewer notes than backed up (a spend) must not report as unbacked.
    markBackedUp(ACCOUNT, [note(0), note(1)])
    expect(countUnbackedNotes(ACCOUNT, [note(0)])).toBe(0)
  })

  it("scopes backup keys per account", () => {
    markBackedUp(ACCOUNT, [note(0)])
    expect(countUnbackedNotes("GOTHER", [note(0)])).toBe(1)
  })
})
