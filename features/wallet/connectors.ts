import type {
  ConnectedAccount,
  WalletProvider,
  WalletProviderId,
} from "@/app/_constants/account"

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
  isStellarAddress,
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

type KitError = {
  code?: number
  ext?: string
  message?: string
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

// All four providers route through this one kit — its unified
// signTransaction/signMessage dispatch to whichever module is currently
// selected (features/wallet/network.ts:114's Freighter-specific network
// check aside, the connect and sign paths below are identical per
// provider). Modules are dynamic-imported and the kit is only
// initialized once per page load; check:bundle enforces every caller of
// @stellar/freighter-api dynamic-imports it, and the Freighter module
// pulls it in transitively, so this stays compliant automatically as
// long as nothing here becomes a static top-level import.
let kitPromise: Promise<{
  Kit: typeof import("@creit-tech/stellar-wallets-kit").StellarWalletsKit
}> | null = null

function ensureKit(): Promise<{
  Kit: typeof import("@creit-tech/stellar-wallets-kit").StellarWalletsKit
}> {
  kitPromise ??= (async () => {
    const [
      { Networks, StellarWalletsKit },
      { FreighterModule },
      { xBullModule },
      { LobstrModule },
      { HanaModule },
    ] = await Promise.all([
      import("@creit-tech/stellar-wallets-kit"),
      import("@creit-tech/stellar-wallets-kit/modules/freighter"),
      import("@creit-tech/stellar-wallets-kit/modules/xbull"),
      import("@creit-tech/stellar-wallets-kit/modules/lobstr"),
      import("@creit-tech/stellar-wallets-kit/modules/hana"),
    ])

    const network = getConfiguredStellarNetwork()
    const kitNetwork =
      network === "public"
        ? Networks.PUBLIC
        : network === "futurenet"
          ? Networks.FUTURENET
          : Networks.TESTNET

    StellarWalletsKit.init({
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new LobstrModule(),
        new HanaModule(),
      ],
      network: kitNetwork,
    })

    return { Kit: StellarWalletsKit }
  })()

  return kitPromise
}

export async function connectWalletProvider(
  provider: WalletProvider
): Promise<ConnectedAccount> {
  if (typeof window === "undefined") {
    throw new WalletConnectionError(
      `${provider.name} can only be connected from a browser.`
    )
  }

  const { Kit } = await ensureKit()
  Kit.setWallet(provider.id)

  let address: string
  try {
    address = (await Kit.fetchAddress()).address
  } catch (cause) {
    throw new WalletConnectionError(describeKitError(cause, provider))
  }

  if (!address) {
    throw new WalletConnectionError(
      `${provider.name} did not return a wallet address.`
    )
  }

  // Only Freighter's module reliably implements getNetwork() — xBull,
  // Lobstr, and Hana all reject it outright (verified by reading each
  // module's source), so a pre-connect network check only exists for
  // Freighter. The other three get whatever network they're on; every
  // sign call still passes an explicit networkPassphrase, so a mismatch
  // surfaces as a sign-time rejection instead of a connect-time one.
  if (provider.id === "freighter") {
    try {
      const networkDetails = await Kit.selectedModule.getNetwork()
      if (!isFreighterNetworkCompatible(networkDetails)) {
        throw new WalletConnectionError(
          `Switch Freighter to ${getConfiguredNetworkLabel()} and try again.`
        )
      }
    } catch (cause) {
      if (cause instanceof WalletConnectionError) throw cause
      // getNetwork() itself failing shouldn't block connecting.
    }
  }

  const balanceResult = await getWalletBalances(address)

  return createConnectedAccount({
    address,
    balance: balanceResult.balance,
    balances: balanceResult.balances,
    provider,
  })
}

/**
 * Sign a transaction XDR with whichever wallet `providerId` names.
 * Every operation hook (deposit, borrow, withdraw, repay, liquidate)
 * routes through this instead of importing a wallet SDK directly, so
 * adding a wallet is one module registration in `ensureKit`, not a
 * signing call site rewritten in six files.
 */
export async function signTransactionWithWallet(
  xdrToSign: string,
  opts: {
    address: string
    networkPassphrase: string
    providerId: WalletProviderId
  }
): Promise<string> {
  const { Kit } = await ensureKit()
  Kit.setWallet(opts.providerId)
  try {
    const { signedTxXdr } = await Kit.signTransaction(xdrToSign, {
      address: opts.address,
      networkPassphrase: opts.networkPassphrase,
    })
    return signedTxXdr
  } catch (cause) {
    throw new WalletConnectionError(
      describeKitError(cause, { id: opts.providerId, name: opts.providerId })
    )
  }
}

/**
 * Sign an arbitrary message with whichever wallet `providerId` names.
 * The shielded identity seed is `SHA-256` of this signature
 * (features/notes/use-shielded-identity.ts) — every provider wired
 * here supports signMessage (verified per-module); WalletConnect,
 * which this replaced, structurally cannot (the protocol has no
 * signMessage method), which is why it could never derive an identity
 * no matter how well its transaction-signing was wired.
 */
export async function signMessageWithWallet(
  message: string,
  opts: {
    address: string
    networkPassphrase: string
    providerId: WalletProviderId
  }
): Promise<string> {
  const { Kit } = await ensureKit()
  Kit.setWallet(opts.providerId)
  try {
    const { signedMessage } = await Kit.signMessage(message, {
      address: opts.address,
      networkPassphrase: opts.networkPassphrase,
    })
    return signedMessage
  } catch (cause) {
    throw new WalletConnectionError(
      describeKitError(cause, { id: opts.providerId, name: opts.providerId })
    )
  }
}

function describeKitError(
  cause: unknown,
  provider: { id: string; name: string }
): string {
  const error = cause as KitError | undefined
  const message = error?.message

  if (message?.includes("is not connected") || message?.includes("is not installed")) {
    return `${provider.name} is not installed or not connected in this browser.`
  }

  return message ?? `Unable to connect ${provider.name}. Try again.`
}

export async function refreshConnectedAccountBalances(
  account: ConnectedAccount
): Promise<ConnectedAccount> {
  const balanceResult = await getWalletBalances(account.wallet.address)

  if (balanceResult.balance === "Balance unavailable") {
    return account
  }

  return {
    wallet: {
      ...account.wallet,
      balance: balanceResult.balance,
      balances: balanceResult.balances,
    },
  }
}

async function getWalletBalances(address: string): Promise<WalletBalanceResult> {
  // Client-side guard so we never hammer Horizon with a malformed
  // strkey (400 loop). Stellar public keys are exactly 56 chars,
  // `G` prefix, base32.
  if (!isStellarAddress(address)) {
    return { balance: "Balance unavailable", balances: {} }
  }
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
