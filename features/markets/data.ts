import type { Asset, Market, SupportedAssetSymbol } from "./types"

export const assets: Record<SupportedAssetSymbol, Asset> = {
  EURC: {
    decimals: 7,
    name: "Euro Coin",
    priceUsd: 1.08,
    symbol: "EURC",
  },
  USDC: {
    decimals: 7,
    name: "USD Coin",
    priceUsd: 1,
    symbol: "USDC",
  },
  XLM: {
    decimals: 7,
    name: "Stellar Lumens",
    priceUsd: 0.12,
    symbol: "XLM",
  },
}

export const assetPricesUsd: Record<SupportedAssetSymbol, number> = {
  EURC: assets.EURC.priceUsd,
  USDC: assets.USDC.priceUsd,
  XLM: assets.XLM.priceUsd,
}

// Only XLM-borrow markets are offered — this product lets users
// borrow XLM (against USDC or EURC collateral), not the reverse.
// USDC/XLM, EURC/USDC, USDC/EURC, and EURC/XLM are all registered
// on-chain (`list_markets` returns all 6 pairs) but deliberately not
// surfaced here.
export const marketCards: Market[] = [
  {
    availableFunds: "$1.2M",
    borrowApr: "6.8%",
    chart: [
      { label: "Mon", value: 4.9 },
      { label: "Tue", value: 5.2 },
      { label: "Wed", value: 5.1 },
      { label: "Thu", value: 5.6 },
      { label: "Fri", value: 6.1 },
      { label: "Sat", value: 6.5 },
      { label: "Sun", value: 6.8 },
    ],
    chartTone: "success",
    collateral: "USDC",
    risk: "Conservative",
    status: "live",
    supplyApy: "3.2%",
    symbol: "XLM",
    utilization: "54%",
  },
  {
    availableFunds: "$560K",
    borrowApr: "7.6%",
    chart: [
      { label: "Mon", value: 5.7 },
      { label: "Tue", value: 5.9 },
      { label: "Wed", value: 6.2 },
      { label: "Thu", value: 6.8 },
      { label: "Fri", value: 7.1 },
      { label: "Sat", value: 7.3 },
      { label: "Sun", value: 7.6 },
    ],
    chartTone: "success",
    collateral: "EURC",
    risk: "Conservative",
    status: "comingSoon",
    supplyApy: "3.5%",
    symbol: "XLM",
    utilization: "59%",
  },
]
