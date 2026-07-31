import { afterEach, describe, expect, it, vi } from "vitest"

import type { rpc } from "@stellar/stellar-sdk"

import {
  cursorLedger,
  fetchAllContractEvents,
  matchesEventFilters,
  mergeById,
  type RpcEvent,
} from "./rpc-events"

const CONTRACT = "CDYTGIGPCTYKTNYFVN2MUAKNMX5VO6RHP6HQQKWZOGXWKNKBQJWKJABU"

const filter = (topics: string[][]): rpc.Api.EventFilter => ({
  type: "contract",
  contractIds: [CONTRACT],
  topics,
})

describe("matchesEventFilters", () => {
  it("requires exact topic slot count", () => {
    const event: RpcEvent = { topics: ["dep", "asset", "extra"] }
    expect(matchesEventFilters(event, [filter([["dep", "*"]])])).toBe(false)
    expect(matchesEventFilters(event, [filter([["dep", "*", "*"]])])).toBe(true)
  })

  it("matches per-slot wildcard or exact string equality", () => {
    const event: RpcEvent = { topics: ["dep", "XLM"] }
    expect(matchesEventFilters(event, [filter([["dep", "XLM"]])])).toBe(true)
    expect(matchesEventFilters(event, [filter([["dep", "USDC"]])])).toBe(false)
    expect(matchesEventFilters(event, [filter([["*", "XLM"]])])).toBe(true)
  })

  it("ORs across filters and across topic patterns", () => {
    const event: RpcEvent = { topics: ["borrow", "XLM", "USDC"] }
    const filters = [
      filter([["dep", "*"]]),
      filter([["withdraw", "*", "*"], ["borrow", "*", "*"]]),
    ]
    expect(matchesEventFilters(event, filters)).toBe(true)
    expect(matchesEventFilters(event, [filter([["dep", "*"]])])).toBe(false)
  })

  it("reads legacy `topic` field like `topics`", () => {
    expect(
      matchesEventFilters({ topic: ["dep", "XLM"] }, [filter([["dep", "*"]])])
    ).toBe(true)
  })

  it("checks contractIds only when the event carries a contractId", () => {
    const event = { topics: ["dep", "XLM"], contractId: "COTHER" }
    expect(matchesEventFilters(event, [filter([["dep", "*"]])])).toBe(false)
    expect(
      matchesEventFilters({ topics: ["dep", "XLM"] }, [filter([["dep", "*"]])])
    ).toBe(true)
  })
})

describe("mergeById", () => {
  it("dedupes by id (RPC sighting wins) and sorts lexicographically", () => {
    const rpcEvents: RpcEvent[] = [
      { id: "0000000020-0", value: "rpc-20" },
      { id: "0000000010-0", value: "rpc-10" },
    ]
    const indexerEvents: RpcEvent[] = [
      { id: "0000000010-0", value: "idx-10" },
      { id: "0000000005-0", value: "idx-05" },
    ]
    const merged = mergeById(rpcEvents, indexerEvents)
    expect(merged.map((e) => e.id)).toEqual([
      "0000000005-0",
      "0000000010-0",
      "0000000020-0",
    ])
    expect(merged[1].value).toBe("rpc-10")
  })

  it("keeps events without an id, last, in arrival order", () => {
    const merged = mergeById(
      [{ value: "no-id-a" }, { id: "0000000001-0" }],
      [{ value: "no-id-b" }]
    )
    expect(merged.map((e) => e.id ?? e.value)).toEqual([
      "0000000001-0",
      "no-id-a",
      "no-id-b",
    ])
  })
})

describe("fetchAllContractEvents merge", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const makeServer = (events: RpcEvent[] | Error) =>
    ({
      getHealth: async () => ({ oldestLedger: 1, latestLedger: 100 }),
      getEvents: async () => {
        if (events instanceof Error) throw events
        return { events, cursor: "" }
      },
    }) as unknown as rpc.Server

  const stubIndexer = (body: unknown, status = 200) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status, json: async () => body }))
    )
  }

  const filters = [filter([["dep", "*"]])]

  it("unions RPC and filter-matching indexer events, deduped by id", async () => {
    stubIndexer([
      { id: "0000000001-0", topics: ["dep", "XLM"], value: "idx-old" },
      { id: "0000000002-0", topics: ["dep", "XLM"], value: "idx-dup" },
      { id: "0000000003-0", topics: ["borrow", "XLM", "USDC"], value: "off" },
    ])
    const events = await fetchAllContractEvents({
      server: makeServer([
        { id: "0000000002-0", topics: ["dep", "XLM"], value: "rpc-dup" },
      ]),
      filters,
    })
    expect(events.map((e) => e.id)).toEqual([
      "0000000001-0",
      "0000000002-0",
    ])
    expect(events[1].value).toBe("rpc-dup")
  })

  it("returns RPC-only when the indexer fails", async () => {
    stubIndexer({ error: "indexer not configured" }, 503)
    const rpcEvents = [{ id: "0000000002-0", topics: ["dep", "XLM"] }]
    const events = await fetchAllContractEvents({
      server: makeServer(rpcEvents),
      filters,
    })
    expect(events).toEqual(rpcEvents)
  })

  it("returns indexer-only when RPC fails but the indexer has events", async () => {
    stubIndexer([{ id: "0000000001-0", topics: ["dep", "XLM"] }])
    const events = await fetchAllContractEvents({
      server: makeServer(new Error("rpc down")),
      filters,
    })
    expect(events.map((e) => e.id)).toEqual(["0000000001-0"])
  })

  it("rethrows the RPC error when both sources fail", async () => {
    stubIndexer({ error: "boom" }, 503)
    await expect(
      fetchAllContractEvents({
        server: makeServer(new Error("rpc down")),
        filters,
      })
    ).rejects.toThrow("rpc down")
  })
})

describe("getEvents pagination termination", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cursorAt = (ledger: number) => `${(BigInt(ledger) << 32n).toString()}-0`

  const makePagedServer = (
    pages: { events: RpcEvent[]; cursor?: string; latestLedger: number }[]
  ) => {
    const getEvents = vi.fn(async () => {
      const page = pages.shift()
      if (!page) throw new Error("unexpected extra getEvents call")
      return page
    })
    return {
      server: {
        getHealth: async () => ({ oldestLedger: 1, latestLedger: 100_000 }),
        getEvents,
      } as unknown as rpc.Server,
      getEvents,
    }
  }

  it("decodes the ledger from a TOID cursor", () => {
    expect(cursorLedger(cursorAt(3_873_463))).toBe(3_873_463)
    expect(cursorLedger("0016189170552668159-4294967295")).toBe(3_769_334)
  })

  it("keeps following the cursor through empty pages until the tip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, json: async () => ({}) })))
    const { server, getEvents } = makePagedServer([
      { events: [], cursor: cursorAt(10_000), latestLedger: 100_000 },
      { events: [], cursor: cursorAt(20_000), latestLedger: 100_000 },
      {
        events: [{ id: "a", topics: ["dep", "XLM"] }],
        cursor: cursorAt(100_000),
        latestLedger: 100_000,
      },
    ])
    const events = await fetchAllContractEvents({
      server,
      filters: [filter([["dep", "*"]])],
    })
    expect(events.map((e) => e.id)).toEqual(["a"])
    expect(getEvents).toHaveBeenCalledTimes(3)
  })

  it("stops when the cursor stops advancing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, json: async () => ({}) })))
    const stuck = cursorAt(50_000)
    const { server, getEvents } = makePagedServer([
      { events: [], cursor: stuck, latestLedger: 100_000 },
      { events: [], cursor: stuck, latestLedger: 100_000 },
    ])
    const events = await fetchAllContractEvents({
      server,
      filters: [filter([["dep", "*"]])],
    })
    expect(events).toEqual([])
    expect(getEvents).toHaveBeenCalledTimes(2)
  })
})
