import { describe, expect, it } from "vitest"

import { createStableId } from "./stable-id"

describe("createStableId", () => {
  it("is deterministic for identical inputs", () => {
    const a = createStableId("intent", "GABC", "XLM", 1000, true)
    const b = createStableId("intent", "GABC", "XLM", 1000, true)

    expect(a).toBe(b)
  })

  it("differs when any part changes", () => {
    const base = createStableId("intent", "GABC", "XLM", 1000)
    const differentAccount = createStableId("intent", "GXYZ", "XLM", 1000)
    const differentSymbol = createStableId("intent", "GABC", "USDC", 1000)
    const differentAmount = createStableId("intent", "GABC", "XLM", 1001)

    expect(differentAccount).not.toBe(base)
    expect(differentSymbol).not.toBe(base)
    expect(differentAmount).not.toBe(base)
  })

  it("differs when prefix changes", () => {
    const intent = createStableId("intent", "GABC", "XLM")
    const tx = createStableId("tx", "GABC", "XLM")

    expect(intent).not.toBe(tx)
  })

  it("accepts boolean parts", () => {
    const truthy = createStableId("proof", "GABC", true)
    const falsy = createStableId("proof", "GABC", false)

    expect(truthy).not.toBe(falsy)
  })

  it("pads short hashes to a stable length", () => {
    const id = createStableId("x", "")
    const [, hash] = id.split("-")

    expect(hash).toHaveLength(7)
  })

  it("returns lower-case base-36 hash", () => {
    const id = createStableId("intent", "GABC", "XLM", 1000)
    const [, hash] = id.split("-")

    expect(hash).toMatch(/^[0-9a-z]{7}$/)
  })

  it("distinguishes different orderings of parts", () => {
    const ab = createStableId("intent", "a", "b")
    const ba = createStableId("intent", "b", "a")

    expect(ab).not.toBe(ba)
  })
})
