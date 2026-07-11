import { describe, expect, it } from "vitest"

import { append, DEPTH, emptyRoot, verifyInclusion, zeroHashes } from "./merkle"
import { poseidon } from "./poseidon"

function makeFrontier(): bigint[] {
  return new Array<bigint>(DEPTH).fill(0n)
}

describe("incremental merkle tree", () => {
  it("empty root matches iterated zero hash", () => {
    const zeros = zeroHashes()
    expect(zeros).toHaveLength(DEPTH + 1)
    expect(zeros[0]).toBe(0n)
    expect(zeros[1]).toBe(poseidon([0n, 0n]))
    expect(emptyRoot()).toBe(zeros[DEPTH])
  })

  it("first append produces path of zero siblings + valid root", () => {
    const frontier = makeFrontier()
    const leaf = 42n
    const { path, root } = append({ frontier, leaf, nextIndex: 0 })

    const zeros = zeroHashes()
    for (let level = 0; level < DEPTH; level++) {
      expect(path[level]).toBe(zeros[level])
    }
    expect(verifyInclusion({ leaf, leafIndex: 0, path, root })).toBe(true)
  })

  it("wrong path fails inclusion check", () => {
    const frontier = makeFrontier()
    const { path, root } = append({ frontier, leaf: 42n, nextIndex: 0 })
    const tampered = path.slice()
    tampered[0] = tampered[0] + 1n
    expect(
      verifyInclusion({ leaf: 42n, leafIndex: 0, path: tampered, root })
    ).toBe(false)
  })

  it("second append at index 1 combines with cached left sibling", () => {
    const frontier = makeFrontier()
    const first = append({ frontier, leaf: 100n, nextIndex: 0 })
    const second = append({ frontier, leaf: 200n, nextIndex: 1 })

    // second leaf's level-0 sibling should be the first leaf.
    expect(second.path[0]).toBe(100n)

    expect(
      verifyInclusion({
        leaf: 200n,
        leafIndex: 1,
        path: second.path,
        root: second.root,
      })
    ).toBe(true)

    // first leaf's inclusion path is invalidated by the new root only if
    // its sibling changed — index-0 sibling is still zeros[0] because
    // the tree is now populated at index-1, so the level-0 sibling for
    // index-0 is the leaf we just inserted.
    const firstFreshPath = first.path.slice()
    firstFreshPath[0] = 200n
    expect(
      verifyInclusion({
        leaf: 100n,
        leafIndex: 0,
        path: firstFreshPath,
        root: second.root,
      })
    ).toBe(true)
  })

  it("stress: sequential appends keep the tree consistent", () => {
    const frontier = makeFrontier()
    const roots: bigint[] = []
    for (let index = 0; index < 8; index++) {
      const result = append({
        frontier,
        leaf: BigInt(1_000 + index),
        nextIndex: index,
      })
      roots.push(result.root)
      expect(
        verifyInclusion({
          leaf: BigInt(1_000 + index),
          leafIndex: index,
          path: result.path,
          root: result.root,
        })
      ).toBe(true)
    }
    // Every append should produce a distinct root.
    const unique = new Set(roots.map((root) => root.toString()))
    expect(unique.size).toBe(roots.length)
  })
})
