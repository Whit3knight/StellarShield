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

const mockWalletIdentity: Omit<
  ConnectedAccount["wallet"],
  "providerId" | "providerName"
> = {
  address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
  balance: "12,480.24 XLM",
  shortAddress: "GDU3...Y9KQ",
}

export function getMockConnectedAccount(
  provider: WalletProvider
): ConnectedAccount {
  return {
    wallet: {
      ...mockWalletIdentity,
      providerId: provider.id,
      providerName: provider.name,
    },
  }
}
