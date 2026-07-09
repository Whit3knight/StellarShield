import { getAssetPriceUsd, type MarketCardData } from "@/features/markets"

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
})

const ASSET_FORMATTER_INTEGER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 0,
})

const ASSET_FORMATTER_SUB_UNIT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 2,
})

const PAIR_PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
})

export function parseAmount(value: string): number {
  const parsedValue = Number.parseFloat(value.replace(/[^0-9.]/g, ""))

  if (Number.isNaN(parsedValue)) {
    return 0
  }

  return parsedValue
}

export function formatUsd(value: number): string {
  return USD_FORMATTER.format(value)
}

export function formatAssetAmount(value: number, symbol: string): string {
  const formatter =
    value > 0 && value < 1 ? ASSET_FORMATTER_SUB_UNIT : ASSET_FORMATTER_INTEGER

  return `${formatter.format(value)} ${symbol}`
}

export function formatPairPrice(market: MarketCardData): string {
  const basePriceUsd = getAssetPriceUsd(market.symbol)
  const quotePriceUsd = getAssetPriceUsd(market.collateral)
  const pairPrice = quotePriceUsd > 0 ? basePriceUsd / quotePriceUsd : 0

  return `1 ${market.symbol} = ${PAIR_PRICE_FORMATTER.format(pairPrice)} ${market.collateral}`
}
