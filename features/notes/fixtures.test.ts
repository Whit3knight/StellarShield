// Cross-checks the on-disk fixture files against the TS-side Poseidon
// + incremental Merkle implementations. Fixtures were emitted by
// contracts/scripts/gen-{poseidon,merkle}-fixtures.ts and live under
// contracts/borrow-pool/tests/. When soroban-sdk 23 lands and
// testutils is restorable, a matching Rust-side reader will load the
// same files to verify the port stays byte-identical across sides.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { append, DEPTH, emptyRoot } from "./merkle"
import { poseidon } from "./poseidon"

const REPO_ROOT = resolve(__dirname, "..", "..")

function loadFixture(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf-8")
}

function parseHex(hex: string): bigint {
  const stripped = hex.trim().startsWith("0x") ? hex.trim().slice(2) : hex.trim()
  return BigInt(`0x${stripped}`)
}

function toHex32(value: bigint): string {
  const hex = value.toString(16).padStart(64, "0")
  return `0x${hex}`
}

describe("poseidon_fixtures.txt", () => {
  const contents = loadFixture("contracts/borrow-pool/tests/poseidon_fixtures.txt")
  const rows = contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  it("has at least one fixture row", () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  for (const line of rows) {
    const [label, inputsField, expectedField] = line.split(";").map((part) => part.trim())
    it(`matches TS Poseidon for "${label}"`, () => {
      const inputs = inputsField.split(",").map((piece) => parseHex(piece))
      const expected = parseHex(expectedField)
      const actual = poseidon(inputs)
      expect(toHex32(actual)).toBe(toHex32(expected))
    })
  }
})

describe("merkle_fixtures.txt", () => {
  const contents = loadFixture("contracts/borrow-pool/tests/merkle_fixtures.txt")
  const headerLines = contents
    .split("\n")
    .filter((line) => line.startsWith("#"))
  const rows = contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  const depthLine = headerLines.find((line) => line.includes("Depth:"))
  const emptyRootLine = headerLines.find((line) => line.includes("empty_root:"))

  it("declares the expected depth", () => {
    expect(depthLine).toBeDefined()
    const depthValue = Number(depthLine!.split(":")[1].trim())
    expect(depthValue).toBe(DEPTH)
  })

  it("matches TS emptyRoot", () => {
    expect(emptyRootLine).toBeDefined()
    const expected = parseHex(emptyRootLine!.split("empty_root:")[1])
    expect(toHex32(emptyRoot())).toBe(toHex32(expected))
  })

  it("has at least one leaf row", () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  // Replay every leaf into a fresh frontier and check the root after
  // each append matches the fixture. Any drift on either the TS
  // Poseidon or the incremental append pattern trips here.
  it("reproduces every fixture root by sequential append", () => {
    const frontier = new Array<bigint>(DEPTH).fill(0n)
    for (const line of rows) {
      const [indexField, leafField, expectedRootField] = line
        .split(";")
        .map((part) => part.trim())
      const nextIndex = Number(indexField)
      const leaf = parseHex(leafField)
      const expected = parseHex(expectedRootField)
      const { root } = append({ frontier, leaf, nextIndex })
      expect(toHex32(root)).toBe(toHex32(expected))
    }
  })
})
