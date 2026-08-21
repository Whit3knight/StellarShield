import type { LucideIcon } from "lucide-react"
import { SmartphoneIcon, WalletCardsIcon } from "lucide-react"

export type WalletProviderId = "freighter" | "walletconnect"

export type WalletProvider = {
  icon: LucideIcon
  id: WalletProviderId
  name: string
  /**
   * Set when the provider can be listed but not used. Every signing path
   * and the shielded-identity derivation import `@stellar/freighter-api`
   * directly (use-deposit, use-borrow, use-withdraw, use-repay,
   * use-liquidate, use-shielded-identity); the wallet kit's
   * `signTransaction` is never called. So a non-Freighter wallet can
   * hand us an address and then nothing works. Listing it without this
   * flag is a dead end with no error message.
   */
  unsupported?: string
}

export type ConnectedAccount = {
  wallet: {
    address: string
    balance: string
    balances?: Record<string, string>
    providerId: WalletProviderId
    providerName: string
    shortAddress: string
  }
}

export const walletProviders: WalletProvider[] = [
  {
    icon: WalletCardsIcon,
    id: "freighter",
    name: "Freighter",
  },
  {
    icon: SmartphoneIcon,
    id: "walletconnect",
    name: "WalletConnect",
    unsupported: "Signing needs the Freighter extension. Mobile wallets can connect but cannot deposit, borrow, or repay.",
  },
]
