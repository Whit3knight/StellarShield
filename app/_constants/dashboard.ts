export type ChartPoint = {
  label: string
  value: number
}

export type ChartTone =
  "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "success"

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
    chartTone: "success",
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
    chartTone: "success",
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
    chartTone: "success",
    collateral: "USDC",
    risk: "Standard",
    status: "comingSoon",
    supplyApy: "4.6%",
    symbol: "EURC",
    utilization: "61%",
  },
  {
    availableFunds: "$710K",
    borrowApr: "7.2%",
    chart: [
      { label: "Mon", value: 6.0 },
      { label: "Tue", value: 6.3 },
      { label: "Wed", value: 6.7 },
      { label: "Thu", value: 6.6 },
      { label: "Fri", value: 6.9 },
      { label: "Sat", value: 7.0 },
      { label: "Sun", value: 7.2 },
    ],
    chartTone: "success",
    collateral: "EURC",
    risk: "Conservative",
    status: "comingSoon",
    supplyApy: "3.8%",
    symbol: "USDC",
    utilization: "57%",
  },
  {
    availableFunds: "$480K",
    borrowApr: "8.1%",
    chart: [
      { label: "Mon", value: 6.9 },
      { label: "Tue", value: 7.1 },
      { label: "Wed", value: 7.4 },
      { label: "Thu", value: 7.6 },
      { label: "Fri", value: 7.8 },
      { label: "Sat", value: 7.9 },
      { label: "Sun", value: 8.1 },
    ],
    chartTone: "success",
    collateral: "XLM",
    risk: "Standard",
    status: "comingSoon",
    supplyApy: "4.4%",
    symbol: "EURC",
    utilization: "63%",
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

export function getMarketPair(
  market: Pick<MarketCardData, "collateral" | "symbol">
): string {
  return `${market.symbol}/${market.collateral}`
}
