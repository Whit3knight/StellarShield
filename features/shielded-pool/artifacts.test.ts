// @vitest-environment node
// jsdom's crypto.subtle.digest rejects cross-realm ArrayBuffers; node's
// does not, and the loader itself is environment-agnostic.
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchArtefact } from "./artifacts"

// A URL whose normalized key ("shielded/borrow/borrow.wasm") is in the
// manifest, so the loader reaches the hash comparison. The bytes we feed
// won't match the real artifact hash — that's the point of the failure test.
const KNOWN_URL = "/circuits-circom/shielded/borrow/borrow.wasm"
const UNKNOWN_URL = "/circuits-circom/shielded/nope/nope.wasm"

function mockFetch(bytes: Uint8Array): void {
  // Return a real ArrayBuffer directly — jsdom's Response.arrayBuffer()
  // yields a polyfilled buffer that Node's crypto.subtle.digest rejects,
  // which never happens in Bun or the browser.
  const buffer = bytes.slice().buffer
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer,
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fetchArtefact integrity", () => {
  it("throws when bytes do not match the manifest hash", async () => {
    mockFetch(new Uint8Array([1, 2, 3, 4]))
    await expect(fetchArtefact(KNOWN_URL)).rejects.toThrow(
      /integrity check failed/
    )
  })

  it("throws when the artifact has no manifest entry", async () => {
    mockFetch(new Uint8Array([1, 2, 3, 4]))
    await expect(fetchArtefact(UNKNOWN_URL)).rejects.toThrow(
      /not in artifact-manifest/
    )
  })

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    )
    await expect(fetchArtefact(KNOWN_URL)).rejects.toThrow(/Failed to fetch/)
  })
})
