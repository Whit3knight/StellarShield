import { assets } from "./data"
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
  return getAsset(symbol).priceUsd
}

export function formatZeroAssetBalance(symbol: SupportedAssetSymbol): string {
  return `0.00 ${symbol}`
}
