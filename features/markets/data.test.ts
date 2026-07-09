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

  it("keeps EURC markets behind coming soon cards", () => {
    const eurcMarkets = marketCards.filter((market) =>
      getMarketPair(market).includes("EURC")
    )

    expect(eurcMarkets).toHaveLength(4)
    expect(eurcMarkets.every((market) => market.status === "comingSoon")).toBe(
      true
    )
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
