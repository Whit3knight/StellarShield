import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConnectedAccount } from "@/app/_constants/account"
import { appPreferenceKeys } from "@/app/_constants/preferences"
import { configureNotePersistence } from "@/features/notes/note-store"

import { refreshConnectedAccountBalances } from "./connectors"
import { useWalletConnection } from "./use-wallet-connection"

vi.mock("./connectors", () => {
  class WalletConnectionError extends Error {}
  class WalletConnectionCanceledError extends Error {}

  return {
    cancelWalletConnectConnection: vi.fn(),
    connectWalletProvider: vi.fn(),
    refreshConnectedAccountBalances: vi.fn(),
    WalletConnectionCanceledError,
    WalletConnectionError,
  }
})

const ADDRESS = "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQABCDEFG"
const CONTRACT = "CCONTRACT"
const identityKey = `stellar-shield:identity:v2:${ADDRESS}`
const notesKey = `stellar-shield:notes:v1:${CONTRACT}:${ADDRESS}`

const connectedAccount: ConnectedAccount = {
  wallet: {
    address: ADDRESS,
    balance: "12,480.25 XLM",
    balances: { XLM: "12,480.25 XLM" },
    providerId: "freighter",
    providerName: "Freighter",
    shortAddress: "GDU3...DEFG",
  },
}

function seedSession(): void {
  window.localStorage.setItem(
    appPreferenceKeys.connectedWallet,
    JSON.stringify(connectedAccount)
  )
  window.localStorage.setItem(identityKey, "ab".repeat(32))
  window.localStorage.setItem(notesKey, "[]")
  configureNotePersistence(CONTRACT, ADDRESS)
}

describe("disconnectAndForget", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(refreshConnectedAccountBalances).mockResolvedValue(
      connectedAccount
    )
    seedSession()
  })

  it("keeps the shielded identity seed and note store on a plain disconnect", () => {
    const { result } = renderHook(() => useWalletConnection())

    act(() => {
      result.current.disconnect()
    })

    expect(
      window.localStorage.getItem(appPreferenceKeys.connectedWallet)
    ).toBeNull()
    expect(window.localStorage.getItem(identityKey)).not.toBeNull()
    expect(window.localStorage.getItem(notesKey)).not.toBeNull()
  })

  it("erases the shielded identity seed and note store when forgetting the device", () => {
    const { result } = renderHook(() => useWalletConnection())

    act(() => {
      result.current.disconnectAndForget()
    })

    expect(
      window.localStorage.getItem(appPreferenceKeys.connectedWallet)
    ).toBeNull()
    expect(window.localStorage.getItem(identityKey)).toBeNull()
    expect(window.localStorage.getItem(notesKey)).toBeNull()
    expect(result.current.account).toBeNull()
  })
})
