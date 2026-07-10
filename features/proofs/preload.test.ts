import { afterEach, describe, expect, it, vi } from "vitest"

import {
  __resetPreloadForTests,
  ensureSnarkjsArtefacts,
  preloadProver,
} from "./preload"

afterEach(() => {
  __resetPreloadForTests()
  vi.unstubAllGlobals()
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

describe("ensureSnarkjsArtefacts", () => {
  it("fetches WASM + zkey once and caches the result", async () => {
    const calls: string[] = []
    const fakeFetch = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      } as Response
    })
    vi.stubGlobal("fetch", fakeFetch)

    const first = await ensureSnarkjsArtefacts({
      wasmUrl: "/circuits-circom/borrow_eligibility.wasm",
      zkeyUrl: "/circuits-circom/borrow_eligibility.zkey",
    })
    const second = await ensureSnarkjsArtefacts({
      wasmUrl: "/circuits-circom/borrow_eligibility.wasm",
      zkeyUrl: "/circuits-circom/borrow_eligibility.zkey",
    })

    expect(first).toBe(second)
    expect(calls.filter((url) => url.endsWith(".wasm"))).toHaveLength(1)
    expect(calls.filter((url) => url.endsWith(".zkey"))).toHaveLength(1)
  })

  it("throws with the URL when the fetch fails", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 404,
    } as Response))

    await expect(
      ensureSnarkjsArtefacts({
        wasmUrl: "/missing.wasm",
        zkeyUrl: "/missing.zkey",
      })
    ).rejects.toThrow(/HTTP 404/)
  })
})
