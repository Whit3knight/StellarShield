import { describe, expect, it } from "vitest"

import { walletProviders } from "@/app/_constants/account"

import {
  createConnectedAccount,
  formatAssetBalance,
  formatWalletAddress,
  formatXlmBalance,
  getMarketWalletBalance,
} from "./utils"

describe("wallet utilities", () => {
  it("formats long Stellar addresses", () => {
    expect(
      formatWalletAddress("GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ")
    ).toBe("GDU3...Y9KQ")
  })

  it("keeps short addresses readable", () => {
    expect(formatWalletAddress("GDU3Y9KQ")).toBe("GDU3Y9KQ")
  })

  it("formats XLM balances", () => {
    expect(formatXlmBalance("12480.2468")).toBe("12,480.2468 XLM")
    expect(formatXlmBalance("9999.9999800")).toBe("9,999.99998 XLM")
    expect(formatXlmBalance("not a balance")).toBe("Balance unavailable")
  })

  it("formats asset balances", () => {
    expect(formatAssetBalance("42", "USDC")).toBe("42 USDC")
    expect(formatAssetBalance("42.5000000", "USDC")).toBe("42.5 USDC")
  })

  it("creates a connected account shape for menus", () => {
    expect(
      createConnectedAccount({
        address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
        balance: "12,480.25 XLM",
        balances: {
          XLM: "12,480.25 XLM",
        },
        provider: walletProviders[0],
      })
    ).toEqual({
      wallet: {
        address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
        balance: "12,480.25 XLM",
        balances: {
          XLM: "12,480.25 XLM",
        },
        providerId: "freighter",
        providerName: "Freighter",
        shortAddress: "GDU3...Y9KQ",
      },
    })
  })

  it("maps wallet balances to the selected market asset", () => {
    const account = createConnectedAccount({
      address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
      balance: "12,480.25 XLM",
      balances: {
        USDC: "25.00 USDC",
        XLM: "12,480.25 XLM",
      },
      provider: walletProviders[0],
    })

    expect(getMarketWalletBalance(null, { symbol: "USDC" })).toBe(
      "Connect wallet"
    )
    expect(getMarketWalletBalance(account, { symbol: "XLM" })).toBe(
      "12,480.25 XLM"
    )
    expect(getMarketWalletBalance(account, { symbol: "USDC" })).toBe(
      "25.00 USDC"
    )
    expect(getMarketWalletBalance(account, { symbol: "EURC" })).toBe(
      "0.00 EURC"
    )
  })
})
