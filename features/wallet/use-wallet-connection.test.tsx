import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { appPreferenceKeys } from "@/app/_constants/preferences"
import { walletProviders, type ConnectedAccount } from "@/app/_constants/account"

import {
  cancelWalletConnectConnection,
  connectWalletProvider,
  refreshConnectedAccountBalances,
  WalletConnectionCanceledError,
} from "./connectors"
import { useWalletConnection } from "./use-wallet-connection"

vi.mock("./connectors", () => {
  class WalletConnectionError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "WalletConnectionError"
    }
  }

  class WalletConnectionCanceledError extends Error {
    constructor(message = "Wallet connection was cancelled.") {
      super(message)
      this.name = "WalletConnectionCanceledError"
    }
  }

  return {
    cancelWalletConnectConnection: vi.fn(),
    connectWalletProvider: vi.fn(),
    refreshConnectedAccountBalances: vi.fn(),
    WalletConnectionCanceledError,
    WalletConnectionError,
  }
})

const connectedAccount: ConnectedAccount = {
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
}

function WalletSnapshotProbe(): React.ReactElement {
  const { account } = useWalletConnection()

  return <div>{account?.wallet.shortAddress ?? "Not connected"}</div>
}

describe("useWalletConnection", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(refreshConnectedAccountBalances).mockResolvedValue(
      connectedAccount
    )
  })

  it("returns a stable stored wallet snapshot", () => {
    window.localStorage.setItem(
      appPreferenceKeys.connectedWallet,
      JSON.stringify(connectedAccount)
    )

    render(<WalletSnapshotProbe />)

    expect(screen.getByText("GDU3...Y9KQ")).toBeInTheDocument()
  })

  it("refreshes cached wallet balances after loading a stored account", async () => {
    const cachedAccount: ConnectedAccount = {
      wallet: {
        ...connectedAccount.wallet,
        balance: "10,000.00 XLM",
        balances: {
          XLM: "10,000.00 XLM",
        },
      },
    }
    const refreshedAccount: ConnectedAccount = {
      wallet: {
        ...connectedAccount.wallet,
        balance: "9,999.99998 XLM",
        balances: {
          XLM: "9,999.99998 XLM",
        },
      },
    }

    vi.mocked(refreshConnectedAccountBalances).mockResolvedValue(
      refreshedAccount
    )
    window.localStorage.setItem(
      appPreferenceKeys.connectedWallet,
      JSON.stringify(cachedAccount)
    )

    const { result } = renderHook(() => useWalletConnection())

    expect(result.current.account?.wallet.balance).toBe("10,000.00 XLM")

    await waitFor(() => {
      expect(result.current.account?.wallet.balance).toBe("9,999.99998 XLM")
    })
    expect(refreshConnectedAccountBalances).toHaveBeenCalledWith(cachedAccount)
    expect(
      JSON.parse(
        window.localStorage.getItem(appPreferenceKeys.connectedWallet) ?? "{}"
      )
    ).toEqual(refreshedAccount)
  })

  it("cancels a pending wallet connection and ignores its eventual result", async () => {
    let resolveConnection: (account: ConnectedAccount) => void = () => undefined
    vi.mocked(connectWalletProvider).mockReturnValue(
      new Promise<ConnectedAccount>((resolve) => {
        resolveConnection = resolve
      })
    )
    const { result } = renderHook(() => useWalletConnection())
    let connectResult: Promise<boolean> = Promise.resolve(false)

    act(() => {
      connectResult = result.current.connect(walletProviders[1])
    })

    expect(result.current.pendingProviderId).toBe("walletconnect")

    act(() => {
      result.current.cancelPendingConnection()
    })

    expect(cancelWalletConnectConnection).toHaveBeenCalledTimes(1)
    expect(result.current.pendingProviderId).toBeNull()

    let connected = true

    await act(async () => {
      resolveConnection(connectedAccount)
      connected = await connectResult
    })

    expect(connected).toBe(false)
    expect(result.current.account).toBeNull()
    expect(
      window.localStorage.getItem(appPreferenceKeys.connectedWallet)
    ).toBeNull()
  })

  it("does not show an error when the wallet modal is closed", async () => {
    vi.mocked(connectWalletProvider).mockRejectedValue(
      new WalletConnectionCanceledError()
    )
    const { result } = renderHook(() => useWalletConnection())
    let connected = true

    await act(async () => {
      connected = await result.current.connect(walletProviders[1])
    })

    expect(connected).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.pendingProviderId).toBeNull()
  })
})
