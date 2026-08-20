import { describe, expect, it } from "vitest"

import { assetPricesUsd, getMarketPair, marketCards } from "."

describe("market data", () => {
  it("lists the supported USDC, EURC, and XLM pair universe", () => {
    expect(marketCards.map((market) => getMarketPair(market))).toEqual([
      "USDC/XLM",
      "XLM/USDC",
      "EURC/USDC",
      "USDC/EURC",
      "EURC/XLM",
      "XLM/EURC",
    ])
  })

  it("exposes the USDC/XLM pairs as live, the rest coming soon", () => {
    const byPair = Object.fromEntries(
      marketCards.map((market) => [getMarketPair(market), market.status])
    )
    expect(byPair).toEqual({
      "USDC/XLM": "live",
      "XLM/USDC": "live",
      "EURC/USDC": "comingSoon",
      "USDC/EURC": "comingSoon",
      "EURC/XLM": "comingSoon",
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
