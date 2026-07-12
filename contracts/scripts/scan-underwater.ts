#!/usr/bin/env bun
/**
 * G-lite watchlist CLI. Enumerates every borrow event on the shielded
 * pool contract within the RPC's retention window, cross-refs with
 * liquidate events to skip closed bonds, fetches the on-chain
 * LiquidationBond for each surviving loan commitment, and prints them
 * sorted oldest first.
 *
 * This is read-only. Bond openings live in encrypted memos and are
 * NOT queried here — so this can't verify a position is actually
 * underwater. It surfaces watchlist candidates for a human (or a
 * future service worker holding the memo openings) to triage.
 *
 * Usage:
 *   bun contracts/scripts/scan-underwater.ts
 *   STELLAR_SHIELD_CONTRACT_ID=... bun contracts/scripts/scan-underwater.ts
 *   LOOKBACK_LEDGERS=32000 bun contracts/scripts/scan-underwater.ts
 */

import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk"

const CONTRACT =
  process.env.STELLAR_SHIELD_CONTRACT_ID ??
  "CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L"
const RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org"
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
const LEDGER_LOOKBACK = Number(process.env.LOOKBACK_LEDGERS ?? "16500")

// Read-only source; all zeros satisfies TransactionBuilder for
// preflight-only simulateTransaction.
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP66"

const SUPPORTED_ASSETS = ["XLM", "USDC", "EURC"] as const
const EVENT_PAGE_LIMIT = 500

type LiquidationBond = {
  borrow_amount_commit: Uint8Array
  collateral_value_commit: Uint8Array
  borrow_price_commit: Uint8Array
  borrow_asset_tag: bigint | number
  collateral_asset_tag: bigint | number
  oracle_epoch: bigint | number
  opened_at: bigint | number
}

async function main(): Promise<void> {
  const server = new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  console.log(
    `contract=${CONTRACT}\nrpc=${RPC_URL}\nscanning ledgers ${startLedger}..${latest.sequence} (${LEDGER_LOOKBACK} back)\n`
  )

  const borrowTopic = xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const liquidateTopic = xdr.ScVal.scvSymbol("liquidat").toXDR("base64")

  const [borrowEvents, liquidateEvents] = await Promise.all([
    fetchEvents(server, borrowTopic, startLedger),
    fetchEvents(server, liquidateTopic, startLedger),
  ])

  const liquidated = new Set<string>()
  for (const event of liquidateEvents) {
    const commit = decodeLiquidateLoanCommit(event)
    if (commit) liquidated.add(bytesToHex(commit))
  }

  const commitments: { commit: Uint8Array; ledgerClosedAt?: string }[] = []
  for (const event of borrowEvents) {
    const commit = decodeBorrowLeaf(event)
    if (!commit) continue
    if (liquidated.has(bytesToHex(commit))) continue
    commitments.push({ commit, ledgerClosedAt: event.ledgerClosedAt })
  }

  console.log(
    `found ${commitments.length} live bonds (${liquidated.size} liquidated within lookback)\n`
  )

  const rows: {
    commit: Uint8Array
    bond: LiquidationBond
    openedAt: number
  }[] = []
  for (const { commit } of commitments) {
    const bond = await fetchBond(server, commit)
    if (!bond) continue
    rows.push({ commit, bond, openedAt: Number(bond.opened_at) })
  }

  rows.sort((a, b) => a.openedAt - b.openedAt)

  const now = Math.floor(Date.now() / 1000)
  console.log(
    "loan_commit           borrow  collateral  opened_at              age"
  )
  console.log(
    "----------------------------------------------------------------------"
  )
  for (const { commit, bond, openedAt } of rows) {
    const commitLabel =
      bytesToHex(commit).slice(0, 8) + "…" + bytesToHex(commit).slice(-4)
    const borrowAsset =
      SUPPORTED_ASSETS[Number(bond.borrow_asset_tag)] ?? "?"
    const collateralAsset =
      SUPPORTED_ASSETS[Number(bond.collateral_asset_tag)] ?? "?"
    const openedIso = new Date(openedAt * 1000).toISOString()
    const age = formatAge(now - openedAt)
    console.log(
      `${commitLabel.padEnd(20)}  ${borrowAsset.padEnd(6)}  ${collateralAsset.padEnd(10)}  ${openedIso}  ${age}`
    )
  }
}

async function fetchEvents(
  server: rpc.Server,
  topic: string,
  startLedger: number
): Promise<RpcEvent[]> {
  const acc: RpcEvent[] = []
  let cursor: string | undefined
  while (true) {
    const req: rpc.Api.GetEventsRequest = cursor
      ? { filters: baseFilter(topic), cursor, limit: EVENT_PAGE_LIMIT }
      : {
          filters: baseFilter(topic),
          startLedger,
          limit: EVENT_PAGE_LIMIT,
        }
    const resp = await server.getEvents(req)
    const events = (resp as { events?: RpcEvent[] }).events ?? []
    acc.push(...events)
    const nextCursor = (resp as { cursor?: string }).cursor
    if (!nextCursor || events.length < EVENT_PAGE_LIMIT) break
    cursor = nextCursor
  }
  return acc
}

function baseFilter(topic: string): rpc.Api.EventFilter[] {
  return [
    {
      type: "contract",
      contractIds: [CONTRACT],
      topics: [[topic]],
    },
  ]
}

type RpcEvent = {
  ledgerClosedAt?: string
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
}

function decodeBorrowLeaf(event: RpcEvent): Uint8Array | null {
  const value = toScVal(event.value)
  if (!value) return null
  let native: unknown
  try {
    native = scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 3) return null
  return coerceBytes(native[2])
}

function decodeLiquidateLoanCommit(event: RpcEvent): Uint8Array | null {
  const value = toScVal(event.value)
  if (!value) return null
  let native: unknown
  try {
    native = scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 1) return null
  return coerceBytes(native[0])
}

async function fetchBond(
  server: rpc.Server,
  commit: Uint8Array
): Promise<LiquidationBond | null> {
  const source = new Account(SIMULATION_SOURCE, "0")
  const contract = new Contract(CONTRACT)
  const arg = xdr.ScVal.scvBytes(Buffer.from(commit))
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("liquidation_bond", arg))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval
  if (!retval) return null
  try {
    const native = scValToNative(retval)
    if (!native) return null
    return native as LiquidationBond
  } catch {
    return null
  }
}

function toScVal(value: unknown): xdr.ScVal | null {
  if (typeof value === "string") {
    try {
      return xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && "toXDR" in value) {
    return value as xdr.ScVal
  }
  return null
}

function coerceBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const out = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = arr[i]
    return out
  }
  return null
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86_400)}d`
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
