export type SupportedAssetSymbol = "USDC" | "EURC" | "XLM"

export type Asset = {
  decimals: number
  name: string
  priceUsd: number
  symbol: SupportedAssetSymbol
}

export type ChartPoint = {
  label: string
  value: number
}

export type ChartTone =
  "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "success"

export type MarketStatus = "live" | "comingSoon"

export type RiskProfile = "Standard" | "Conservative"

export type Market = {
  availableFunds: string
  borrowApr: string
  chart: ChartPoint[]
  chartTone: ChartTone
  collateral: SupportedAssetSymbol
  risk: RiskProfile
  status: MarketStatus
  supplyApy: string
  symbol: SupportedAssetSymbol
  utilization: string
}

export type MarketCardData = Market
