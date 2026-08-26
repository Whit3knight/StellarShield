import { describe, expect, it } from "vitest"

import { assetPricesUsd, getMarketPair, marketCards } from "."

describe("market data", () => {
  it("only offers XLM-borrow pairs", () => {
    expect(marketCards.map((market) => getMarketPair(market))).toEqual([
      "XLM/USDC",
      "XLM/EURC",
    ])
    expect(marketCards.every((market) => market.symbol === "XLM")).toBe(true)
  })

  it("exposes the XLM/USDC pair as live, XLM/EURC as coming soon", () => {
    const byPair = Object.fromEntries(
      marketCards.map((market) => [getMarketPair(market), market.status])
    )
    expect(byPair).toEqual({
      "XLM/USDC": "live",
      "XLM/EURC": "comingSoon",
    })
  })

  it("uses success chart tone and explicit asset prices", () => {
    expect(marketCards.every((market) => market.chartTone === "success")).toBe(
      true
    )
    expect(assetPricesUsd).toEqual({
      EURC: 1.08,
      USDC: 1,
      XLM: 0.12,
    })
  })
})
