// QA probe — does the new `onIndexerDown` signal (commit 3ab80b4) stay
// quiet on an aborted scan? React StrictMode double-mounts
// `useShieldedPool`, whose cleanup aborts the first controller, and the
// scanner also re-runs on every confirmation. A false "indexer down"
// there would train the user to dismiss a fund-loss warning.
//
// All tests here PASS: the behaviour is correct. They exist because
// nothing else pins it, and the abort path is one `throwIfAborted()`
// line away from regressing.

import type { rpc } from "@stellar/stellar-sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchAllContractEvents, fetchIndexerEvents } from "./rpc-events"

const filters = [
  {
    type: "contract" as const,
    contractIds: ["CCONTRACT"],
    topics: [["dep", "*"]],
  },
] as unknown as rpc.Api.EventFilter[]

const makeServer = () =>
  ({
    getHealth: async () => ({ oldestLedger: 1, latestLedger: 100 }),
    getEvents: async () => ({ events: [], cursor: "" }),
  }) as unknown as rpc.Server

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("onIndexerDown under abort", () => {
  it("stays silent when the scan is aborted mid-flight", async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        // The real abort path: useShieldedPool's cleanup fires while the
        // indexer request is open, so fetch rejects with AbortError and
        // fetchIndexerEvents collapses it into `down`.
        controller.abort()
        const err = new Error("The operation was aborted.")
        err.name = "AbortError"
        void init
        throw err
      })
    )
    const onIndexerDown = vi.fn()

    await expect(
      fetchAllContractEvents({
        server: makeServer(),
        filters,
        signal: controller.signal,
        onIndexerDown,
      })
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(onIndexerDown).not.toHaveBeenCalled()
  })

  it("stays silent when the signal was already aborted before the call", async () => {
    const controller = new AbortController()
    controller.abort()
    const onIndexerDown = vi.fn()

    await expect(
      fetchAllContractEvents({
        server: makeServer(),
        filters,
        signal: controller.signal,
        onIndexerDown,
      })
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(onIndexerDown).not.toHaveBeenCalled()
  })

  it("an abort still reads as `down` at the fetchIndexerEvents layer", async () => {
    // Documents where the abort is absorbed: only the throwIfAborted()
    // in fetchAllContractEvents keeps it from reaching the caller.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("The operation was aborted.")
        err.name = "AbortError"
        throw err
      })
    )
    const result = await fetchIndexerEvents("CCONTRACT")
    expect(result.events).toEqual([])
    expect(result.down).toBe("The operation was aborted.")
  })

  it("reports down when no contractId is present in the filters", async () => {
    // A degenerate filter set silently disables the indexer; the hook
    // now names it rather than reading as 'indexer had nothing'.
    vi.stubGlobal("fetch", vi.fn())
    const onIndexerDown = vi.fn()
    await fetchAllContractEvents({
      server: makeServer(),
      filters: [
        { type: "contract", topics: [["dep", "*"]] },
      ] as unknown as rpc.Api.EventFilter[],
      onIndexerDown,
    })
    expect(onIndexerDown).toHaveBeenCalledWith("no contractId in filters")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("hits the indexer once per fetchAllContractEvents call", async () => {
    // scanShieldedNotes issues TWO of these per scan (filtersA + filtersB)
    // against the same contract, so a healthy scan pulls the full indexed
    // event set over the wire twice and filters it client-side.
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url)
      return { status: 200, json: async () => [], text: async () => "[]" }
    })
    vi.stubGlobal("fetch", fetchMock)
    await fetchAllContractEvents({ server: makeServer(), filters })
    await fetchAllContractEvents({ server: makeServer(), filters })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Identical request both times — scanShieldedNotes pays for the full
    // indexed event set twice per scan and filters it client-side.
    expect(new Set(urls).size).toBe(1)
  })
})
