import { afterEach, describe, expect, it } from "vitest"

import {
  getConfiguredHorizonUrl,
  getConfiguredNetworkLabel,
  getConfiguredStellarNetwork,
  isFreighterNetworkCompatible,
} from "./network"

const originalNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK
const originalHorizonUrl = process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL

afterEach(() => {
  if (originalNetwork === undefined) {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK
  } else {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalNetwork
  }

  if (originalHorizonUrl === undefined) {
    delete process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL
  } else {
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL = originalHorizonUrl
  }
})

describe("wallet network configuration", () => {
  it("defaults the app to Stellar testnet", () => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK
    delete process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL

    expect(getConfiguredStellarNetwork()).toBe("testnet")
    expect(getConfiguredNetworkLabel()).toBe("Testnet")
    expect(getConfiguredHorizonUrl()).toBe(
      "https://horizon-testnet.stellar.org"
    )
  })

  it("uses an explicit Horizon URL when configured", () => {
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL =
      "https://example.com/horizon/"

    expect(getConfiguredHorizonUrl()).toBe("https://example.com/horizon")
  })

  it("detects Freighter network mismatch against the configured network", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet"

    expect(
      isFreighterNetworkCompatible({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
    ).toBe(true)

    expect(
      isFreighterNetworkCompatible({
        network: "PUBLIC",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      })
    ).toBe(false)
  })
})
