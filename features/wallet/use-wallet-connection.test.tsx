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
import { getConfiguredNetworkPassphrase } from "./network"
import { useWalletConnection } from "./use-wallet-connection"

type WatchCallback = (params: {
  address: string
  network: string
  networkPassphrase: string
}) => void

class FakeWatcher {
  static instances: FakeWatcher[] = []
  private cb: WatchCallback | null = null
  stopped = false

  watch(cb: WatchCallback): Record<string, never> {
    this.cb = cb
    FakeWatcher.instances.push(this)
    return {}
  }

  stop(): void {
    this.stopped = true
  }

  emit(params: {
    address: string
    network: string
    networkPassphrase: string
  }): void {
    this.cb?.(params)
  }
}

vi.mock("@stellar/freighter-api", () => ({
  WatchWalletChanges: FakeWatcher,
}))

vi.mock("@/components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
}))

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
    address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQABCDEFG",
    balance: "12,480.25 XLM",
    balances: {
      XLM: "12,480.25 XLM",
    },
    providerId: "freighter",
    providerName: "Freighter",
    shortAddress: "GDU3...DEFG",
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
    FakeWatcher.instances = []
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

    expect(screen.getByText("GDU3...DEFG")).toBeInTheDocument()
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

  describe("live wallet watcher", () => {
    async function renderConnected() {
      window.localStorage.setItem(
        appPreferenceKeys.connectedWallet,
        JSON.stringify(connectedAccount)
      )
      const hook = renderHook(() => useWalletConnection())
      await waitFor(() => expect(FakeWatcher.instances).toHaveLength(1))
      return { hook, watcher: FakeWatcher.instances[0] }
    }

    it("disconnects when Freighter reports the address locked away", async () => {
      const { hook, watcher } = await renderConnected()

      await act(async () => {
        watcher.emit({
          address: "",
          network: "TESTNET",
          networkPassphrase: getConfiguredNetworkPassphrase(),
        })
      })

      expect(hook.result.current.account).toBeNull()
      expect(
        window.localStorage.getItem(appPreferenceKeys.connectedWallet)
      ).toBeNull()
    })

    it("disconnects when Freighter's active account changes", async () => {
      const { hook, watcher } = await renderConnected()
      const otherAddress =
        "GBOTHERZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"

      await act(async () => {
        watcher.emit({
          address: otherAddress,
          network: "TESTNET",
          networkPassphrase: getConfiguredNetworkPassphrase(),
        })
      })

      expect(hook.result.current.account).toBeNull()
    })

    it("disconnects when Freighter's network no longer matches the app", async () => {
      const { hook, watcher } = await renderConnected()

      await act(async () => {
        watcher.emit({
          address: connectedAccount.wallet.address,
          network: "PUBLIC",
          networkPassphrase: "Public Global Stellar Network ; September 2015",
        })
      })

      expect(hook.result.current.account).toBeNull()
    })

    it("does nothing when address and network still match — no false disconnect", async () => {
      const { hook, watcher } = await renderConnected()

      await act(async () => {
        watcher.emit({
          address: connectedAccount.wallet.address,
          network: "TESTNET",
          networkPassphrase: getConfiguredNetworkPassphrase(),
        })
      })

      expect(hook.result.current.account?.wallet.address).toBe(
        connectedAccount.wallet.address
      )
    })

    it("stops the watcher on unmount so a stray callback cannot fire after", async () => {
      const { hook, watcher } = await renderConnected()

      hook.unmount()

      expect(watcher.stopped).toBe(true)
    })

    it("preserves the identity seed and note cache — a lock is not 'forget this device'", async () => {
      const identityKey = `stellar-shield:identity:v2:${connectedAccount.wallet.address}`
      window.localStorage.setItem(identityKey, "a".repeat(64))
      const { hook, watcher } = await renderConnected()

      await act(async () => {
        watcher.emit({
          address: "",
          network: "TESTNET",
          networkPassphrase: getConfiguredNetworkPassphrase(),
        })
      })

      expect(hook.result.current.account).toBeNull()
      expect(window.localStorage.getItem(identityKey)).toBe("a".repeat(64))
    })
  })
})
