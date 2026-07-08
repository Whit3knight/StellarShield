import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api"

import type { ConnectedAccount, WalletProvider } from "@/app/_constants/account"
import type { ModuleInterface } from "@creit-tech/stellar-wallets-kit"

import {
  getConfiguredHorizonUrl,
  getConfiguredNetworkLabel,
  getConfiguredStellarNetwork,
  isFreighterNetworkCompatible,
} from "./network"
import {
  createConnectedAccount,
  formatAssetBalance,
  formatXlmBalance,
} from "./utils"

type HorizonAccountResponse = {
  balances?: Array<{
    asset_code?: string
    asset_type?: string
    balance?: string
  }>
}

type WalletBalanceResult = {
  balance: string
  balances: Record<string, string>
}

type WalletConnectModalState = {
  open: boolean
}

type WalletConnectModal = {
  close?: () => Promise<void> | void
  getState?: () => WalletConnectModalState
  subscribeState?: (
    callback: (state: WalletConnectModalState) => void
  ) => () => void
}

type WalletConnectModuleWithModal = ModuleInterface & {
  modal?: WalletConnectModal
}

type FreighterError = {
  code?: number
  message?: string
}

type FreighterResult = {
  error?: FreighterError
}

export class WalletConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WalletConnectionError"
  }
}

export class WalletConnectionCanceledError extends Error {
  constructor(message = "Wallet connection was cancelled.") {
    super(message)
    this.name = "WalletConnectionCanceledError"
  }
}

export async function connectWalletProvider(
  provider: WalletProvider
): Promise<ConnectedAccount> {
  if (provider.id === "freighter") {
    return connectFreighter(provider)
  }

  return connectWalletConnect(provider)
}

async function connectFreighter(
  provider: WalletProvider
): Promise<ConnectedAccount> {
  if (typeof window === "undefined") {
    throw new WalletConnectionError(
      "Freighter can only be connected from a browser."
    )
  }

  const connection = await isConnected()
  assertFreighterResult(connection)

  if (!connection.isConnected) {
    throw new WalletConnectionError(
      "Freighter is not installed or not enabled in this browser."
    )
  }

  const access = await requestAccess()
  assertFreighterResult(access)

  const address = access.address

  if (!address) {
    throw new WalletConnectionError(
      "Freighter did not return a wallet address."
    )
  }

  const networkDetails = await getNetworkDetails()
  assertFreighterResult(networkDetails)

  if (!isFreighterNetworkCompatible(networkDetails)) {
    throw new WalletConnectionError(
      `Switch Freighter to ${getConfiguredNetworkLabel()} and try again.`
    )
  }

  const balanceResult = await getWalletBalances(address)

  return createConnectedAccount({
    address,
    balance: balanceResult.balance,
    balances: balanceResult.balances,
    provider,
  })
}

let walletConnectModule: ModuleInterface | null = null
const walletConnectCloseGraceMs = 150

export function cancelWalletConnectConnection(): void {
  const modal = walletConnectModule
    ? getWalletConnectModal(walletConnectModule)
    : null

  if (!modal?.close) {
    return
  }

  void Promise.resolve(modal.close()).catch(() => undefined)
}

async function connectWalletConnect(
  provider: WalletProvider
): Promise<ConnectedAccount> {
  if (typeof window === "undefined") {
    throw new WalletConnectionError(
      "WalletConnect can only be opened from a browser."
    )
  }

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()

  if (!projectId) {
    throw new WalletConnectionError(
      "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID."
    )
  }

  const { Networks, StellarWalletsKit } = await import(
    "@creit-tech/stellar-wallets-kit"
  )
  const {
    WALLET_CONNECT_ID,
    WalletConnectModule,
    WalletConnectTargetChain,
  } = await import("@creit-tech/stellar-wallets-kit/modules/wallet-connect")
  const network = getConfiguredStellarNetwork()

  if (network === "futurenet") {
    throw new WalletConnectionError(
      "WalletConnect supports Public and Testnet only."
    )
  }

  const kitNetwork =
    network === "public" ? Networks.PUBLIC : Networks.TESTNET
  const allowedChain =
    network === "public"
      ? WalletConnectTargetChain.PUBLIC
      : WalletConnectTargetChain.TESTNET

  if (!walletConnectModule) {
    walletConnectModule = new WalletConnectModule({
      allowedChains: [allowedChain],
      metadata: {
        description:
          "Private lending and borrowing on Stellar with ZKP verification.",
        icons: [`${window.location.origin}/stellar-shield-black.svg`],
        name: "Stellar Shield",
        url: window.location.origin,
      },
      projectId,
    })

    StellarWalletsKit.init({
      modules: [walletConnectModule],
      network: kitNetwork,
      selectedWalletId: WALLET_CONNECT_ID,
    })
  }

  await waitForWalletConnectModule(walletConnectModule)
  StellarWalletsKit.setNetwork(kitNetwork)
  StellarWalletsKit.setWallet(WALLET_CONNECT_ID)

  const { address } = await fetchWalletConnectAddress(
    StellarWalletsKit,
    walletConnectModule
  )

  if (!address) {
    throw new WalletConnectionError(
      "WalletConnect did not return a wallet address."
    )
  }

  const balanceResult = await getWalletBalances(address)

  return createConnectedAccount({
    address,
    balance: balanceResult.balance,
    balances: balanceResult.balances,
    provider,
  })
}

async function fetchWalletConnectAddress(
  StellarWalletsKit: typeof import("@creit-tech/stellar-wallets-kit").StellarWalletsKit,
  module: ModuleInterface
): Promise<{ address: string }> {
  const modal = getWalletConnectModal(module)

  if (!modal?.subscribeState) {
    return StellarWalletsKit.fetchAddress()
  }

  let hasOpened = modal.getState?.().open ?? false
  let closeTimer: number | null = null
  let unsubscribe: (() => void) | null = null

  return new Promise((resolve, reject) => {
    const settle = (callback: () => void): void => {
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer)
      }

      unsubscribe?.()
      unsubscribe = null
      callback()
    }

    unsubscribe = modal.subscribeState?.((state) => {
      if (state.open) {
        hasOpened = true
        return
      }

      if (!hasOpened || closeTimer !== null) {
        return
      }

      closeTimer = window.setTimeout(() => {
        settle(() => {
          reject(new WalletConnectionCanceledError())
        })
      }, walletConnectCloseGraceMs)
    }) ?? null

    StellarWalletsKit.fetchAddress()
      .then((result) => {
        settle(() => {
          resolve(result)
        })
      })
      .catch((error: unknown) => {
        settle(() => {
          reject(error)
        })
      })
  })
}

function getWalletConnectModal(module: ModuleInterface): WalletConnectModal | null {
  return (module as WalletConnectModuleWithModal).modal ?? null
}

async function waitForWalletConnectModule(
  module: ModuleInterface,
  timeoutMs = 5000
): Promise<void> {
  const startedAt = Date.now()

  while (!(await module.isAvailable())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new WalletConnectionError("WalletConnect failed to start.")
    }

    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
}

function assertFreighterResult(result: FreighterResult): void {
  if (result.error) {
    throw new WalletConnectionError(
      result.error.message ?? "Freighter returned an error."
    )
  }
}

async function getWalletBalances(address: string): Promise<WalletBalanceResult> {
  try {
    const horizonUrl = getConfiguredHorizonUrl()
    const response = await fetch(`${horizonUrl}/accounts/${address}`)

    if (response.status === 404) {
      return {
        balance: `Not funded on ${getConfiguredNetworkLabel()}`,
        balances: {},
      }
    }

    if (!response.ok) {
      return {
        balance: "Balance unavailable",
        balances: {},
      }
    }

    const account = (await response.json()) as HorizonAccountResponse
    const balances =
      account.balances?.reduce<Record<string, string>>((assetBalances, item) => {
        if (!item.balance) {
          return assetBalances
        }

        if (item.asset_type === "native") {
          assetBalances.XLM = formatXlmBalance(item.balance)
          return assetBalances
        }

        if (item.asset_code) {
          assetBalances[item.asset_code] = formatAssetBalance(
            item.balance,
            item.asset_code
          )
        }

        return assetBalances
      }, {}) ?? {}
    const nativeBalance = account.balances?.find(
      (balance) => balance.asset_type === "native"
    )?.balance

    return {
      balance: nativeBalance
        ? formatXlmBalance(nativeBalance)
        : "Balance unavailable",
      balances,
    }
  } catch {
    return {
      balance: "Balance unavailable",
      balances: {},
    }
  }
}
