import { describe, expect, it } from "vitest"

import {
  append,
  computeCommitment,
  DENOMINATION,
  DEPTH,
  replaceNotes,
  verifyInclusion,
  type ShieldedNote,
} from "@/features/notes"

import {
  buildFinalStateWitnesses,
  mergeLeaves,
  ownNoteLeaves,
} from "./withdraw-tree"

describe("mergeLeaves", () => {
  it("backfills head roll-off with own note leaves", () => {
    const events = [
      { index: 2, leaf: 33n },
      { index: 3, leaf: 44n },
    ]
    const own = [
      { index: 0, leaf: 11n },
      { index: 1, leaf: 22n },
    ]
    const { leaves, gaps } = mergeLeaves(events, own, 4)
    expect(leaves).toEqual([11n, 22n, 33n, 44n])
    expect(gaps).toEqual([])
  })

  it("reports unresolvable gaps", () => {
    const { gaps } = mergeLeaves(
      [{ index: 2, leaf: 33n }],
      [{ index: 0, leaf: 11n }],
      3
    )
    expect(gaps).toEqual([1])
  })

  it("event leaf wins a conflict with an own leaf", () => {
    const { leaves, gaps } = mergeLeaves(
      [{ index: 0, leaf: 99n }],
      [{ index: 0, leaf: 11n }],
      1
    )
    expect(leaves).toEqual([99n])
    expect(gaps).toEqual([])
  })

  it("ignores indices beyond leafCount", () => {
    const { leaves, gaps } = mergeLeaves(
      [{ index: 5, leaf: 55n }],
      [{ index: 0, leaf: 11n }],
      1
    )
    expect(leaves).toEqual([11n])
    expect(gaps).toEqual([])
  })
})

describe("buildFinalStateWitnesses", () => {
  it("root matches an incremental append over the same leaves", () => {
    const leaves = [101n, 202n, 303n, 404n, 505n]
    const frontier = new Array<bigint>(DEPTH).fill(0n)
    let appendRoot = 0n
    leaves.forEach((leaf, index) => {
      appendRoot = append({ frontier, leaf, nextIndex: index }).root
    })

    const witnesses = buildFinalStateWitnesses(leaves)
    expect(witnesses).toHaveLength(leaves.length)
    for (const witness of witnesses) {
      expect(witness.root).toBe(appendRoot)
      expect(
        verifyInclusion({
          leaf: witness.leaf,
          leafIndex: witness.leafIndex,
          path: witness.pathElements,
          root: witness.root,
        })
      ).toBe(true)
    }
  })

  it("wantedIndices limits emission without changing the witnesses", () => {
    const leaves = [101n, 202n, 303n, 404n, 505n]
    const all = buildFinalStateWitnesses(leaves)
    const some = buildFinalStateWitnesses(leaves, new Set([1, 3]))
    expect(some.map((w) => w.leafIndex)).toEqual([1, 3])
    expect(some).toEqual(all.filter((w) => [1, 3].includes(w.leafIndex)))
  })
})

describe("ownNoteLeaves", () => {
  const base: ShieldedNote = {
    amount: DENOMINATION.XLM,
    asset: "XLM",
    index: 0,
    salt: 11n,
    sk: 7n,
    tree: "deposit",
  }

  it("includes spent notes and recomputes legacy zero-amount tombstones", () => {
    replaceNotes([
      base,
      { ...base, index: 1, spent: true },
      { ...base, index: 2, amount: 0n },
      { ...base, index: 3, asset: "USDC" },
      { ...base, index: 4, tree: "loan" },
    ])
    const leaves = ownNoteLeaves("XLM", "deposit")
    expect(leaves.map((l) => l.index)).toEqual([0, 1, 2])
    // Commitment ignores index/spent, so all three (incl. the legacy
    // zeroed tombstone, rebuilt at the fixed denomination) match.
    const expectedLeaf = computeCommitment(base)
    for (const { leaf } of leaves) expect(leaf).toBe(expectedLeaf)
    replaceNotes([])
  })
})
