import type { ConnectedAccount, WalletProvider } from "@/app/_constants/account"

const ASSET_BALANCE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

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
  const numericBalance =
    typeof balance === "number" ? balance : Number.parseFloat(balance)

  if (Number.isNaN(numericBalance)) {
    return "Balance unavailable"
  }

  return `${ASSET_BALANCE_FORMATTER.format(numericBalance)} ${symbol}`
}

export function getMarketWalletBalance(
  account: ConnectedAccount | null,
  market: { symbol: string }
): string {
  if (!account) {
    return "Connect wallet"
  }

  if (market.symbol === "XLM") {
    return account.wallet.balance
  }

  return account.wallet.balances?.[market.symbol] ?? `0.00 ${market.symbol}`
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
