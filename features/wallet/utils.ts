import type { ConnectedAccount, WalletProvider } from "@/app/_constants/account"

const BALANCE_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

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
  market: { symbol: string }
): string {
  if (!account) {
    return "Connect wallet"
  }

  return getWalletAssetBalance(account, market.symbol) ?? `0.00 ${market.symbol}`
}

export function getWalletAssetBalance(
  account: ConnectedAccount | null,
  symbol: string
): string | null {
  if (!account) {
    return null
  }

  if (symbol === "XLM") {
    return account.wallet.balances?.XLM ?? account.wallet.balance
  }

  return account.wallet.balances?.[symbol] ?? null
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
