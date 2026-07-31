import { decimal, toString } from "@/features/shared/money"

import { assets } from "./data"
import { readCachedAssetPrice } from "./price-cache"
import type { Market, SupportedAssetSymbol } from "./types"

/**
 * Raw token units (stroops) → human string, using the one registry of
 * per-asset decimals. Note amounts are raw everywhere; anything that
 * prints them goes through here.
 */
export function formatRawAmount(
  raw: bigint,
  symbol: SupportedAssetSymbol
): string {
  return toString(decimal(raw, assets[symbol].decimals))
}

export function getMarketPair(
  market: Pick<Market, "collateral" | "symbol">
): string {
  return `${market.symbol}/${market.collateral}`
}

export function getAsset(symbol: SupportedAssetSymbol) {
  return assets[symbol]
}

export function getAssetPriceUsd(symbol: SupportedAssetSymbol): number {
  return readCachedAssetPrice(symbol)
}

export function formatZeroAssetBalance(symbol: SupportedAssetSymbol): string {
  return `0.00 ${symbol}`
}

export function getMarketSearchValue(
  market: Pick<Market, "collateral" | "symbol">
): string {
  const pair = getMarketPair(market)
  const symbolName = assets[market.symbol].name
  const collateralName = assets[market.collateral].name

  return `${pair} ${symbolName} ${collateralName}`.toLowerCase()
}
