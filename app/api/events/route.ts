// Serves indexed contract events (Goldsky -> Neon) to the frontend
// event merge in features/notes/rpc-events.ts. Dark-launched: without
// DATABASE_URL this returns 503 and the client stays RPC-only.
//
// Goldsky stores topics/data as DECODED ScVal JSON (verified against
// live rows: [{"symbol":"borrow"},...] / {"vec":[{"u64":"1"},
// {"bytes":"<hex>"}]}). The client decoders expect base64 XDR, so each
// row is re-encoded server-side via scval-json; rows that fail to
// convert are dropped, degrading to RPC-only rather than corrupting.

import { neon } from "@neondatabase/serverless"

import { scValJsonToBase64 } from "@/features/notes/scval-json"

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/
const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  try {
    const contract = new URL(request.url).searchParams.get("contract")
    if (!contract || !CONTRACT_ID_RE.test(contract)) {
      return Response.json(
        { error: "invalid contract" },
        { status: 400, headers: NO_STORE }
      )
    }

    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      return Response.json(
        { error: "indexer not configured" },
        { status: 503, headers: NO_STORE }
      )
    }

    let rows: Record<string, unknown>[]
    try {
      const sql = neon(databaseUrl)
      rows = await sql`
        SELECT id, topics, data, transaction_hash, ledger_sequence,
               ledger_closed_at
        FROM stellar_shield_events
        WHERE contract_id = ${contract}
        ORDER BY id
        LIMIT 50000
      `
    } catch (cause) {
      console.error("[api/events] query failed", cause)
      return Response.json(
        { error: "indexer unavailable" },
        { status: 503, headers: NO_STORE }
      )
    }

    const events = []
    for (const row of rows) {
      const topics = parseTopics(row.topics).map(scValJsonToBase64)
      const value = scValJsonToBase64(parseData(row.data))
      if (!value || topics.some((topic) => topic === null)) continue
      events.push({
        id: String(row.id),
        topics,
        value,
        ledgerClosedAt: toIso(row.ledger_closed_at),
      })
    }
    return Response.json(events, { headers: NO_STORE })
  } catch (cause) {
    console.error("[api/events]", cause)
    return Response.json(
      { error: "internal error" },
      { status: 500, headers: NO_STORE }
    )
  }
}

function parseTopics(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // not JSON — fall through
    }
  }
  return []
}

function parseData(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

function toIso(raw: unknown): string | undefined {
  const date =
    raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
