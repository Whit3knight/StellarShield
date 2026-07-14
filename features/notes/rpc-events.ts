// Cursor-paginated Soroban getEvents over the full RPC retention
// window. getHealth() reports the oldest retained ledger, so callers
// no longer guess a fixed lookback and silently miss events that
// rolled past it.

import type { rpc } from "@stellar/stellar-sdk"

export type RpcEvent = {
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

  const health = await server.getHealth()
  throwIfAborted()
  // +10 keeps startLedger inside the window even if the oldest ledger
  // rolls forward between getHealth and the first getEvents call —
  // the RPC rejects startLedger below its retention floor.
  const startLedger = Math.min(health.oldestLedger + 10, health.latestLedger)

  const events: RpcEvent[] = []
  let page = await server.getEvents({ filters, startLedger, limit: PAGE_LIMIT })
  for (;;) {
    throwIfAborted()
    const pageEvents = page.events ?? []
    events.push(...(pageEvents as unknown as RpcEvent[]))
    if (pageEvents.length < PAGE_LIMIT || !page.cursor) break
    page = await server.getEvents({
      filters,
      cursor: page.cursor,
      limit: PAGE_LIMIT,
    })
  }
  return events
}
