import type { LucideIcon } from "lucide-react"
import { SmartphoneIcon, WalletCardsIcon } from "lucide-react"

export type WalletProviderId = "freighter" | "walletconnect"

export type WalletProvider = {
  icon: LucideIcon
  id: WalletProviderId
  name: string
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
  },
]
