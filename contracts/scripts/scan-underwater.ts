#!/usr/bin/env bun
/**
 * Watchlist CLI for the shielded pool. Two modes:
 *
 *   Unauthenticated (default): enumerate every borrow event within
 *   the RPC retention window, skip loan_commitments that already
 *   appear in a liquidate event, fetch the on-chain LiquidationBond
 *   for the survivors, print them sorted oldest first. Openings live
 *   in encrypted memos and stay opaque — this only surfaces triage
 *   candidates.
 *
 *   Authenticated (LIQUIDATION_SERVICE_SK env set to a 32-byte hex
 *   X25519 secret matching the on-chain LiquidationServicePk slot):
 *   also decrypt each borrow memo, extract the bond openings, fetch
 *   the current Reflector price for the borrow asset, and compute
 *   the same underwater inequality the liquidate circuit enforces:
 *     loan_amount × threshold_bps × borrow_price
 *       > collateral_notional × current_price × 10_000
 *   Underwater bonds are marked with `**` and printed with the ratio.
 *   Still read-only — trigger flow lives in the frontend
 *   `useLiquidate` hook until a signing story lands here.
 *
 * Usage:
 *   bun contracts/scripts/scan-underwater.ts
 *   STELLAR_SHIELD_CONTRACT_ID=... bun contracts/scripts/scan-underwater.ts
 *   LOOKBACK_LEDGERS=32000 bun contracts/scripts/scan-underwater.ts
 *   LIQUIDATION_SERVICE_SK=0x... bun contracts/scripts/scan-underwater.ts
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

import { tryDecryptAnyMemo } from "@/features/notes/memo"

const CONTRACT =
  process.env.STELLAR_SHIELD_CONTRACT_ID ??
  "CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L"
const RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org"
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
const LEDGER_LOOKBACK = Number(process.env.LOOKBACK_LEDGERS ?? "16500")

const REFLECTOR_CEX =
  process.env.STELLAR_REFLECTOR_CEX_CONTRACT_ID ??
  "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63"

// Fixed 8500 bps default matches contract's initialize_shielded call.
// Optional env override for staging deployments with tighter limits.
const LIQUIDATION_THRESHOLD_BPS = Number(
  process.env.LIQUIDATION_THRESHOLD_BPS ?? "8500"
)

function loadServiceSecret(): Uint8Array | null {
  const raw = process.env.LIQUIDATION_SERVICE_SK?.trim()
  if (!raw) return null
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw
  if (hex.length !== 64) {
    throw new Error(
      `LIQUIDATION_SERVICE_SK must be 32 hex bytes; got ${hex.length / 2}`
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

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

  const serviceSk = loadServiceSecret()
  const authenticated = serviceSk !== null
  console.log(
    authenticated
      ? "mode=authenticated (decrypting memos + computing HF)"
      : "mode=watchlist (bond metadata only)"
  )
  console.log("")

  const commitments: {
    commit: Uint8Array
    ledgerClosedAt?: string
    memo?: Uint8Array
  }[] = []
  for (const event of borrowEvents) {
    const decoded = decodeBorrowEvent(event)
    if (!decoded) continue
    if (liquidated.has(bytesToHex(decoded.commit))) continue
    commitments.push({
      commit: decoded.commit,
      ledgerClosedAt: event.ledgerClosedAt,
      memo: decoded.memo,
    })
  }

  console.log(
    `found ${commitments.length} live bonds (${liquidated.size} liquidated within lookback)\n`
  )

  const rows: {
    commit: Uint8Array
    bond: LiquidationBond
    openedAt: number
    underwater?: boolean
    hfRatio?: number
  }[] = []

  const priceCache = new Map<string, bigint>()
  const fetchPrice = async (asset: string): Promise<bigint | null> => {
    if (priceCache.has(asset)) return priceCache.get(asset)!
    const price = await fetchReflectorPrice(server, asset)
    if (price !== null) priceCache.set(asset, price)
    return price
  }

  for (const { commit, memo } of commitments) {
    const bond = await fetchBond(server, commit)
    if (!bond) continue
    const openedAt = Number(bond.opened_at)
    const borrowAsset =
      SUPPORTED_ASSETS[Number(bond.borrow_asset_tag)] ?? null

    let underwater: boolean | undefined
    let hfRatio: number | undefined
    if (authenticated && memo && borrowAsset) {
      const opened = decryptOpenings(memo, serviceSk!)
      if (opened) {
        const priceNow = await fetchPrice(borrowAsset)
        if (priceNow !== null) {
          const check = checkUnderwater({
            loanAmount: opened.loanAmount,
            collateralNotional: opened.collateralNotional,
            borrowPrice: opened.borrowPrice,
            priceNow,
          })
          underwater = check.underwater
          hfRatio = check.hfRatio
        }
      }
    }

    rows.push({ commit, bond, openedAt, underwater, hfRatio })
  }

  // Sort underwater first (if authenticated), then oldest.
  rows.sort((a, b) => {
    if (authenticated) {
      const au = a.underwater ? 1 : 0
      const bu = b.underwater ? 1 : 0
      if (au !== bu) return bu - au
    }
    return a.openedAt - b.openedAt
  })

  const now = Math.floor(Date.now() / 1000)
  console.log(
    "loan_commit            borrow  collateral  opened_at              age    hf"
  )
  console.log(
    "-------------------------------------------------------------------------------"
  )
  for (const { commit, bond, openedAt, underwater, hfRatio } of rows) {
    const commitLabel =
      bytesToHex(commit).slice(0, 8) + "…" + bytesToHex(commit).slice(-4)
    const borrowAsset =
      SUPPORTED_ASSETS[Number(bond.borrow_asset_tag)] ?? "?"
    const collateralAsset =
      SUPPORTED_ASSETS[Number(bond.collateral_asset_tag)] ?? "?"
    const openedIso = new Date(openedAt * 1000).toISOString()
    const age = formatAge(now - openedAt)
    const hfLabel =
      hfRatio !== undefined
        ? `${underwater ? "** " : "   "}${hfRatio.toFixed(2)}x`
        : "-"
    console.log(
      `${commitLabel.padEnd(20)}  ${borrowAsset.padEnd(6)}  ${collateralAsset.padEnd(10)}  ${openedIso}  ${age.padEnd(5)}  ${hfLabel}`
    )
  }

  if (authenticated) {
    const underwaterCount = rows.filter((r) => r.underwater).length
    console.log(
      `\n${underwaterCount} underwater bond${underwaterCount === 1 ? "" : "s"} flagged. Trigger via useLiquidate in the frontend.`
    )
  }
}

type BorrowEventDecoded = {
  commit: Uint8Array
  memo?: Uint8Array
}

function decodeBorrowEvent(event: RpcEvent): BorrowEventDecoded | null {
  const value = toScVal(event.value)
  if (!value) return null
  let native: unknown
  try {
    native = scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 3) return null
  const commit = coerceBytes(native[2])
  if (!commit) return null
  const memo = native.length >= 4 ? coerceBytes(native[3]) ?? undefined : undefined
  return { commit, memo }
}

function decryptOpenings(
  memo: Uint8Array,
  serviceSk: Uint8Array
): {
  loanAmount: bigint
  collateralNotional: bigint
  borrowPrice: bigint
} | null {
  const plaintext = tryDecryptAnyMemo({ raw: memo, recipientSk: serviceSk })
  if (!plaintext || plaintext.tree !== "loan" || !plaintext.bond) return null
  try {
    return {
      loanAmount: BigInt(plaintext.amount),
      collateralNotional: BigInt(plaintext.bond.collateralValue),
      borrowPrice: BigInt(plaintext.bond.oraclePrice),
    }
  } catch {
    return null
  }
}

function checkUnderwater(inputs: {
  loanAmount: bigint
  collateralNotional: bigint
  borrowPrice: bigint
  priceNow: bigint
}): { underwater: boolean; hfRatio: number } {
  const lhs =
    inputs.loanAmount * BigInt(LIQUIDATION_THRESHOLD_BPS) * inputs.borrowPrice
  const rhs = inputs.collateralNotional * inputs.priceNow * 10_000n
  const underwater = lhs > rhs
  // hf_ratio = collateral_value_now / (loan_amount * threshold)
  //          = (collateral_notional * priceNow) / (loan_amount * threshold * borrowPrice / 10_000)
  //          = rhs / lhs
  const hfRatio = lhs === 0n ? Infinity : Number(rhs) / Number(lhs)
  return { underwater, hfRatio }
}

async function fetchReflectorPrice(
  server: rpc.Server,
  ticker: string
): Promise<bigint | null> {
  const source = new Account(SIMULATION_SOURCE, "0")
  const contract = new Contract(REFLECTOR_CEX)
  const assetScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    xdr.ScVal.scvSymbol(ticker),
  ])
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("lastprice", assetScVal))
    .setTimeout(30)
    .build()
  try {
    const sim = await server.simulateTransaction(tx)
    const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval
    if (!retval) return null
    const native = scValToNative(retval) as { price?: bigint } | null
    if (!native || typeof native.price === "undefined") return null
    return BigInt(native.price)
  } catch {
    return null
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
