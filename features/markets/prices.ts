import { assets } from "./data"
import type { SupportedAssetSymbol } from "./types"

import {
  getConfiguredNetworkPassphrase,
  getConfiguredReflectorCexContractId,
  getConfiguredReflectorFxContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Reflector Pulse `lastprice(Asset) -> Option<PriceData>` where
// `PriceData = { price: i128, timestamp: u64 }`. Prices are quoted in
// USD at `decimals()` precision (14 across the current public feeds).
// Docs: https://github.com/reflector-network/reflector-contract.
type ReflectorFeed = "cex" | "fx"

type ReflectorAssetRef = {
  feed: ReflectorFeed
  ticker: string
}

// XLM/USDC live in the CEX/DEX oracle; EURC uses the FX oracle's EUR
// quote (EURC ≈ 1 EUR at issuance). Update when we add tokens that
// route through a different Reflector feed.
const REFLECTOR_ASSETS: Record<SupportedAssetSymbol, ReflectorAssetRef> = {
  EURC: { feed: "fx", ticker: "EUR" },
  USDC: { feed: "cex", ticker: "USDC" },
  XLM: { feed: "cex", ticker: "XLM" },
}

// Public key used only to satisfy TransactionBuilder for read-only
// `simulateTransaction`. Preflight ignores account existence — no funds
// required. This is the all-zeros ed25519 address (StrKey.encode of 32
// zero bytes); it must be a checksum-valid strkey or `new Account()`
// throws "accountId is invalid".
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

export type ReflectorPrice = {
  decimals: number
  price: bigint
  timestamp: number
}

/**
 * Fetch the latest Reflector price for `symbol`. Returns `null` if no
 * feed is configured, the oracle has no record for the ticker, or the
 * simulation fails. Caller decides how to fall back.
 */
export async function fetchReflectorPrice(
  symbol: SupportedAssetSymbol,
  signal?: AbortSignal
): Promise<ReflectorPrice | null> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const ref = REFLECTOR_ASSETS[symbol]
  const contractId =
    ref.feed === "cex"
      ? getConfiguredReflectorCexContractId()
      : getConfiguredReflectorFxContractId()

  if (!contractId) return null

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const source = new sdk.Account(SIMULATION_SOURCE, "0")
  const contract = new sdk.Contract(contractId)

  const assetScVal = sdk.xdr.ScVal.scvVec([
    sdk.xdr.ScVal.scvSymbol("Other"),
    sdk.xdr.ScVal.scvSymbol(ref.ticker),
  ])

  const tx = new sdk.TransactionBuilder(source, {
    fee: sdk.BASE_FEE,
    networkPassphrase: getConfiguredNetworkPassphrase(),
  })
    .addOperation(contract.call("lastprice", assetScVal))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  if (rpc.Api.isSimulationError(sim)) return null

  const retval = sim.result?.retval
  if (!retval) return null

  const native = sdk.scValToNative(retval) as
    | null
    | { price?: bigint | number; timestamp?: bigint | number }

  if (!native || native.price === undefined) return null

  const price =
    typeof native.price === "bigint" ? native.price : BigInt(native.price)
  const timestamp =
    typeof native.timestamp === "bigint"
      ? Number(native.timestamp)
      : Number(native.timestamp ?? 0)

  const decimals = await fetchReflectorDecimals(contractId, signal)

  return { decimals, price, timestamp }
}

const decimalsCache = new Map<string, number>()

async function fetchReflectorDecimals(
  contractId: string,
  signal?: AbortSignal
): Promise<number> {
  const cached = decimalsCache.get(contractId)
  if (cached !== undefined) return cached

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const source = new sdk.Account(SIMULATION_SOURCE, "0")
  const contract = new sdk.Contract(contractId)

  const tx = new sdk.TransactionBuilder(source, {
    fee: sdk.BASE_FEE,
    networkPassphrase: getConfiguredNetworkPassphrase(),
  })
    .addOperation(contract.call("decimals"))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  if (rpc.Api.isSimulationError(sim)) return 14

  const retval = sim.result?.retval
  const native = retval ? sdk.scValToNative(retval) : null
  const decimals =
    typeof native === "number"
      ? native
      : typeof native === "bigint"
        ? Number(native)
        : 14

  decimalsCache.set(contractId, decimals)
  return decimals
}

/** Fixed-point scale of every cross-asset ratio below. */
export const PRICE_RATIO_DECIMALS = 14
export const PRICE_RATIO_SCALE = 10n ** BigInt(PRICE_RATIO_DECIMALS)

/**
 * Price of one RAW `collateral` unit expressed in RAW `borrow` units,
 * scaled by `PRICE_RATIO_SCALE`:
 *
 *   ratio = P_collateral / P_borrow
 *         × 10^(dec_borrow − dec_collateral)   ← token decimals
 *         × 1e14
 *
 * Both factors are written out rather than folded into a constant. The
 * token-decimal factor is exactly 1 today (all three SACs are 7
 * decimals) and the feed-decimal factor cancels while every feed
 * reports 14 — keeping them visible is what stops a 6-decimal asset
 * from silently re-breaking borrow sizing.
 *
 * Throws when either leg has no usable feed. Callers that can tolerate
 * a missing oracle fall back to `PRICE_RATIO_SCALE` (parity) at the
 * call site; liquidation callers deliberately do not.
 */
export async function fetchPriceRatio(
  collateral: SupportedAssetSymbol,
  borrow: SupportedAssetSymbol,
  signal?: AbortSignal
): Promise<bigint> {
  if (collateral === borrow) return PRICE_RATIO_SCALE

  const [collateralPrice, borrowPrice] = await Promise.all([
    fetchReflectorPrice(collateral, signal),
    fetchReflectorPrice(borrow, signal),
  ])

  if (!collateralPrice || collateralPrice.price <= 0n) {
    throw new Error(`Reflector returned no price for ${collateral}`)
  }
  if (!borrowPrice || borrowPrice.price <= 0n) {
    throw new Error(`Reflector returned no price for ${borrow}`)
  }

  const exponent =
    PRICE_RATIO_DECIMALS +
    (borrowPrice.decimals - collateralPrice.decimals) +
    (assets[borrow].decimals - assets[collateral].decimals)

  return exponent >= 0
    ? (collateralPrice.price * 10n ** BigInt(exponent)) / borrowPrice.price
    : collateralPrice.price / (borrowPrice.price * 10n ** BigInt(-exponent))
}

/**
 * Convert a Reflector price record to a plain USD float. Losing
 * precision here is fine because the value only feeds display / quote
 * math — the raw bigint stays available for the prover witness.
 */
export function reflectorPriceToUsd(price: ReflectorPrice): number {
  const divisor = 10 ** price.decimals
  return Number(price.price) / divisor
}
