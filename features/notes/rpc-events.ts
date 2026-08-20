// Cursor-paginated Soroban getEvents over the full RPC retention
// window. getHealth() reports the oldest retained ledger, so callers
// no longer guess a fixed lookback and silently miss events that
// rolled past it.
//
// When an indexer is reachable (/api/events in the browser,
// EVENTS_API_URL elsewhere), its events are merged in — filtered
// client-side through the caller's EventFilter semantics, deduped by
// event id against the RPC page — so scans outlive RPC retention.
// No indexer configured → exactly the RPC-only behavior.

import type { rpc } from "@stellar/stellar-sdk"

export type RpcEvent = {
  id?: string
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
  ledgerClosedAt?: string
}

const PAGE_LIMIT = 500

export async function fetchAllContractEvents(params: {
  server: rpc.Server
  filters: rpc.Api.EventFilter[]
  signal?: AbortSignal
}): Promise<RpcEvent[]> {
  const { server, filters, signal } = params
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  }
  throwIfAborted()

  const contractId = filters[0]?.contractIds?.[0]
  const [rpcResult, indexerResult] = await Promise.allSettled([
    fetchRpcEvents(server, filters, signal),
    contractId
      ? fetchIndexerEvents(contractId, signal)
      : Promise.resolve<RpcEvent[]>([]),
  ])
  throwIfAborted()

  const indexerEvents =
    indexerResult.status === "fulfilled"
      ? indexerResult.value.filter((event) =>
          matchesEventFilters(event, filters)
        )
      : []

  if (rpcResult.status === "rejected") {
    if (indexerEvents.length === 0) throw rpcResult.reason
    console.warn(
      "[rpc-events] getEvents failed — serving indexer-only",
      rpcResult.reason
    )
    return mergeById([], indexerEvents)
  }
  if (indexerEvents.length === 0) return rpcResult.value
  return mergeById(rpcResult.value, indexerEvents)
}

async function fetchRpcEvents(
  server: rpc.Server,
  filters: rpc.Api.EventFilter[],
  signal?: AbortSignal
): Promise<RpcEvent[]> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  }
  const health = await server.getHealth()
  throwIfAborted()
  // +10 keeps startLedger inside the window even if the oldest ledger
  // rolls forward between getHealth and the first getEvents call —
  // the RPC rejects startLedger below its retention floor.
  const startLedger = Math.min(health.oldestLedger + 10, health.latestLedger)

  const events: RpcEvent[] = []
  let page = await server.getEvents({ filters, startLedger, limit: PAGE_LIMIT })
  let previousCursor: string | undefined
  for (;;) {
    throwIfAborted()
    const pageEvents = page.events ?? []
    events.push(...(pageEvents as unknown as RpcEvent[]))
    const cursor = page.cursor
    // stellar-rpc scans at most ~10k ledgers per call and returns an
    // EMPTY page with a cursor when the scan bound is hit before
    // `limit` events are found. Breaking on a short/empty page (the
    // old check) silently truncated every scan to the first ~10k
    // ledgers of the retention window. Terminate only when the cursor
    // has reached the chain tip, is missing, or stops advancing.
    if (!cursor || cursor === previousCursor) break
    if (cursorLedger(cursor) >= page.latestLedger) break
    previousCursor = cursor
    page = await server.getEvents({ filters, cursor, limit: PAGE_LIMIT })
  }
  return events
}

/** Ledger sequence encoded in a getEvents TOID-style cursor. */
export function cursorLedger(cursor: string): number {
  return Number(BigInt(cursor.split("-")[0]) >> 32n)
}

/**
 * Indexed events for `contractId` from the Goldsky→Neon route. Never
 * throws — any failure (no config, non-200, network, abort) collapses
 * to [] so the RPC path keeps today's behavior on its own.
 */
export async function fetchIndexerEvents(
  contractId: string,
  signal?: AbortSignal
): Promise<RpcEvent[]> {
  try {
    const base =
      typeof window === "undefined"
        ? process.env.EVENTS_API_URL
        : "/api/events"
    if (!base) return []
    const response = await fetch(
      `${base}?contract=${encodeURIComponent(contractId)}`,
      { signal }
    )
    if (response.status !== 200) return []
    const body: unknown = await response.json()
    return Array.isArray(body) ? (body as RpcEvent[]) : []
  } catch {
    return []
  }
}

/**
 * Replay getEvents filter semantics client-side. Callers rely on
 * server-side topic filtering for correctness (e.g. the withdraw-tree
 * deposit filter never re-checks the asset), so indexer events must
 * pass the exact same test before joining the union: any filter
 * matches; a filter's contractIds must include the event's contract
 * (skipped when the event carries none — the indexer is already
 * scoped); any of its topic patterns must match on exact slot count
 * with per-slot "*" wildcard or base64-string equality.
 */
export function matchesEventFilters(
  event: RpcEvent & { contractId?: unknown },
  filters: rpc.Api.EventFilter[]
): boolean {
  const topics =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  for (const filter of filters) {
    if (
      typeof event.contractId === "string" &&
      filter.contractIds &&
      !filter.contractIds.includes(event.contractId)
    ) {
      continue
    }
    for (const pattern of filter.topics ?? []) {
      if (pattern.length !== topics.length) continue
      if (pattern.every((slot, i) => slot === "*" || slot === topics[i])) {
        return true
      }
    }
  }
  return false
}

/**
 * Union of RPC + indexer events deduped by event id (RPC sighting
 * wins), sorted lexicographically by id — getEvents ids are
 * zero-padded, so this is ledger order. Events without an id cannot be
 * deduped; they sort last in arrival order.
 */
export function mergeById(
  rpcEvents: RpcEvent[],
  indexerEvents: RpcEvent[]
): RpcEvent[] {
  const seen = new Set<string>()
  const withId: RpcEvent[] = []
  const withoutId: RpcEvent[] = []
  for (const event of [...rpcEvents, ...indexerEvents]) {
    if (typeof event.id === "string" && event.id.length > 0) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      withId.push(event)
    } else {
      withoutId.push(event)
    }
  }
  withId.sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0))
  return [...withId, ...withoutId]
}
