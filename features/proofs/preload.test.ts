import { afterEach, describe, expect, it } from "vitest"

import { __resetPreloadForTests, preloadProver } from "./preload"

afterEach(() => {
  __resetPreloadForTests()
})

describe("preloadProver", () => {
  it("resolves without throwing when deps are missing", async () => {
    await expect(preloadProver()).resolves.toBeUndefined()
  })

  it("memoises the in-flight promise across concurrent calls", () => {
    const first = preloadProver()
    const second = preloadProver()
    expect(first).toBe(second)
  })

  it("resets after failure so the next call retries fresh", async () => {
    const first = preloadProver()
    await first

    __resetPreloadForTests()

    const second = preloadProver()
    expect(first).not.toBe(second)
    await expect(second).resolves.toBeUndefined()
  })
})
