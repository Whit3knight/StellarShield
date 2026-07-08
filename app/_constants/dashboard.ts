export type ChartPoint = {
  label: string
  value: number
}

export type ChartTone =
  "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5"

export type MarketStatus = "live" | "comingSoon"

export type MarketCardData = {
  availableFunds: string
  borrowApr: string
  chart: ChartPoint[]
  chartTone: ChartTone
  collateral: string
  risk: "Standard" | "Conservative"
  status: MarketStatus
  supplyApy: string
  symbol: string
  utilization: string
}

export const marketCards: MarketCardData[] = [
  {
    availableFunds: "$840K",
    borrowApr: "7.4%",
    chart: [
      { label: "Mon", value: 5.8 },
      { label: "Tue", value: 6.4 },
      { label: "Wed", value: 6.1 },
      { label: "Thu", value: 6.9 },
      { label: "Fri", value: 7.4 },
      { label: "Sat", value: 7.1 },
      { label: "Sun", value: 7.4 },
    ],
    chartTone: "chart-2",
    collateral: "XLM",
    risk: "Standard",
    status: "live",
    supplyApy: "4.1%",
    symbol: "USDC",
    utilization: "68%",
  },
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
    chartTone: "chart-1",
    collateral: "USDC",
    risk: "Conservative",
    status: "live",
    supplyApy: "3.2%",
    symbol: "XLM",
    utilization: "54%",
  },
  {
    availableFunds: "$620K",
    borrowApr: "7.9%",
    chart: [
      { label: "Mon", value: 6.6 },
      { label: "Tue", value: 6.9 },
      { label: "Wed", value: 7.2 },
      { label: "Thu", value: 7.0 },
      { label: "Fri", value: 7.5 },
      { label: "Sat", value: 7.7 },
      { label: "Sun", value: 7.9 },
    ],
    chartTone: "chart-4",
    collateral: "USDC",
    risk: "Standard",
    status: "comingSoon",
    supplyApy: "4.6%",
    symbol: "EURC",
    utilization: "61%",
  },
  {
    availableFunds: "$520K",
    borrowApr: "8.6%",
    chart: [
      { label: "Mon", value: 7.8 },
      { label: "Tue", value: 8.0 },
      { label: "Wed", value: 7.9 },
      { label: "Thu", value: 8.2 },
      { label: "Fri", value: 8.4 },
      { label: "Sat", value: 8.5 },
      { label: "Sun", value: 8.6 },
    ],
    chartTone: "chart-5",
    collateral: "USDC",
    risk: "Conservative",
    status: "comingSoon",
    supplyApy: "4.8%",
    symbol: "BTC",
    utilization: "66%",
  },
]

export function getMarketPair(
  market: Pick<MarketCardData, "collateral" | "symbol">
): string {
  return `${market.symbol}/${market.collateral}`
}
