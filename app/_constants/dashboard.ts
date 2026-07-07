export type ChartPoint = {
  label: string
  value: number
}

export type MarketCardData = {
  availableFunds: string
  borrowApr: string
  chart: ChartPoint[]
  collateral: string
  risk: "Standard" | "Conservative"
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
    collateral: "XLM",
    risk: "Standard",
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
    collateral: "USDC",
    risk: "Conservative",
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
    collateral: "USDC",
    risk: "Standard",
    supplyApy: "4.6%",
    symbol: "EURC",
    utilization: "61%",
  },
  {
    availableFunds: "$310K",
    borrowApr: "9.2%",
    chart: [
      { label: "Mon", value: 8.1 },
      { label: "Tue", value: 8.4 },
      { label: "Wed", value: 8.3 },
      { label: "Thu", value: 8.8 },
      { label: "Fri", value: 9.0 },
      { label: "Sat", value: 8.9 },
      { label: "Sun", value: 9.2 },
    ],
    collateral: "USDC",
    risk: "Standard",
    supplyApy: "5.3%",
    symbol: "AQUA",
    utilization: "73%",
  },
]

export const borrowOverview = {
  availableToBorrow: "$4,250.00",
  borrowApr: "7.4%",
  chart: [
    { label: "Jan", value: 2200 },
    { label: "Feb", value: 2450 },
    { label: "Mar", value: 3100 },
    { label: "Apr", value: 2920 },
    { label: "May", value: 3600 },
    { label: "Jun", value: 3900 },
    { label: "Jul", value: 4250 },
  ],
  collateral: "$6,800.00",
  loanStatus: "Healthy",
  verification: "Ready",
}

export function getMarketPair(
  market: Pick<MarketCardData, "collateral" | "symbol">
): string {
  return `${market.symbol}/${market.collateral}`
}
