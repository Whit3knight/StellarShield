import { describe, expect, it } from "vitest"

import { marketCards } from "./data"
import {
  getMarketPair,
  getMarketSearchValue,
} from "./utils"

describe("getMarketPair", () => {
  it("joins symbol and collateral with a slash", () => {
    expect(getMarketPair({ symbol: "USDC", collateral: "XLM" })).toBe(
      "USDC/XLM"
    )
  })
})

describe("getMarketSearchValue", () => {
  it("includes the pair and both asset names, lowercased", () => {
    expect(getMarketSearchValue({ symbol: "USDC", collateral: "XLM" })).toBe(
      "usdc/xlm usd coin stellar lumens"
    )
  })

  it("is stable across the whole market list", () => {
    for (const market of marketCards) {
      const value = getMarketSearchValue(market)
      expect(value).toBe(value.toLowerCase())
      expect(value).toContain(market.symbol.toLowerCase())
      expect(value).toContain(market.collateral.toLowerCase())
    }
  })

  it("filters case-insensitively on partial asset-name queries", () => {
    const xlmMarket = marketCards.find((m) => m.symbol === "XLM")
    if (!xlmMarket) throw new Error("XLM market missing")

    const value = getMarketSearchValue(xlmMarket)

    expect(value.includes("usd coin")).toBe(true)
    expect(value.includes("stellar lumens")).toBe(true)
  })
})
