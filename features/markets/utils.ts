import { assets } from "./data"
import { readCachedAssetPrice } from "./price-cache"
import type { Market, SupportedAssetSymbol } from "./types"

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
