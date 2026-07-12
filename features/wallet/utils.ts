import type { ConnectedAccount, WalletProvider } from "@/app/_constants/account"
import {
  formatZeroAssetBalance,
  type SupportedAssetSymbol,
} from "@/features/markets"

const BALANCE_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

// Stellar ed25519 public key strkey: 'G' prefix + 55 chars = 56.
// Deliberately loose on the character set — the real bug we guard
// against is truncation. Full base32-alphabet + checksum enforcement
// lives in Freighter / stellar-sdk; the client-side guard just needs
// to catch obviously malformed lengths before a Horizon 400 loop.
const STELLAR_ADDRESS_PATTERN = /^G[A-Z0-9]{55}$/

/**
 * True for a well-formed Stellar strkey (56 chars, `G` prefix,
 * base32 alphabet). Any wallet-connect flow must reject anything
 * else — a truncated address writes garbage into localStorage and
 * every subsequent Horizon poll returns 400 on loop.
 */
export function isStellarAddress(address: unknown): address is string {
  return typeof address === "string" && STELLAR_ADDRESS_PATTERN.test(address)
}

export function formatWalletAddress(address: string): string {
  const trimmedAddress = address.trim()

  if (trimmedAddress.length <= 12) {
    return trimmedAddress
  }

  return `${trimmedAddress.slice(0, 4)}...${trimmedAddress.slice(-4)}`
}

export function formatXlmBalance(balance: string | number): string {
  return formatAssetBalance(balance, "XLM")
}

export function formatAssetBalance(
  balance: string | number,
  symbol: string
): string {
  const parsedBalance = parseBalance(balance)

  if (!parsedBalance) {
    return "Balance unavailable"
  }

  const { fractionDigits, isNegative, wholeDigits } = parsedBalance
  const formattedWholeDigits = formatWholeDigits(wholeDigits)
  const signedWholeDigits = isNegative
    ? `-${formattedWholeDigits}`
    : formattedWholeDigits
  const formattedBalance = fractionDigits
    ? `${signedWholeDigits}.${fractionDigits}`
    : signedWholeDigits

  return `${formattedBalance} ${symbol}`
}

function parseBalance(balance: string | number): {
  fractionDigits: string
  isNegative: boolean
  wholeDigits: string
} | null {
  const rawBalance = String(balance).trim()
  const match = BALANCE_PATTERN.exec(rawBalance)

  if (!match) {
    return null
  }

  const [, sign, wholeDigits, fractionDigits = ""] = match
  const normalizedWholeDigits = wholeDigits.replace(/^0+(?=\d)/, "")
  const normalizedFractionDigits = fractionDigits.replace(/0+$/, "")
  const isZeroBalance =
    normalizedWholeDigits === "0" && normalizedFractionDigits.length === 0

  return {
    fractionDigits: normalizedFractionDigits,
    isNegative: sign === "-" && !isZeroBalance,
    wholeDigits: normalizedWholeDigits,
  }
}

function formatWholeDigits(wholeDigits: string): string {
  return wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function getMarketWalletBalance(
  account: ConnectedAccount | null,
  market: { symbol: SupportedAssetSymbol }
): string {
  if (!account) {
    return "Connect wallet"
  }

  return getWalletAssetBalanceDisplay(account, market.symbol)
}

export function getWalletAssetBalance(
  account: ConnectedAccount | null,
  symbol: SupportedAssetSymbol
): string | null {
  if (!account) {
    return null
  }

  if (symbol === "XLM") {
    return account.wallet.balances?.XLM ?? account.wallet.balance
  }

  return account.wallet.balances?.[symbol] ?? null
}

export function getWalletAssetBalanceDisplay(
  account: ConnectedAccount | null,
  symbol: SupportedAssetSymbol
): string {
  if (!account) {
    return "Connect wallet"
  }

  return (
    getWalletAssetBalance(account, symbol) ?? formatZeroAssetBalance(symbol)
  )
}

export function hasWalletAssetBalance(
  account: ConnectedAccount | null,
  symbol: SupportedAssetSymbol
): boolean {
  return Boolean(getWalletAssetBalance(account, symbol))
}

export function createConnectedAccount({
  address,
  balance,
  balances,
  provider,
}: {
  address: string
  balance: string
  balances?: Record<string, string>
  provider: WalletProvider
}): ConnectedAccount {
  if (!isStellarAddress(address)) {
    const raw = String(address ?? "")
    throw new Error(
      `createConnectedAccount: refusing to store malformed Stellar address "${raw}" (length ${raw.length}; expected 56 chars starting with G)`
    )
  }
  return {
    wallet: {
      address,
      balance,
      balances,
      providerId: provider.id,
      providerName: provider.name,
      shortAddress: formatWalletAddress(address),
    },
  }
}
