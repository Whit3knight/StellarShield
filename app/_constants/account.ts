import type { LucideIcon } from "lucide-react"
import { KeyRoundIcon, ShellIcon, WalletCardsIcon, ZapIcon } from "lucide-react"

export type WalletProviderId = "freighter" | "hana" | "lobstr" | "xbull"

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

// All four route through @creit-tech/stellar-wallets-kit's unified
// signTransaction/signMessage (features/wallet/connectors.ts), so every
// listed provider can actually complete a shielded operation — unlike
// the WalletConnect entry this replaced, whose protocol cannot sign a
// message at all (confirmed: stellarwalletskit.dev/how-to/sign-with-
// wallet.html) and so could never derive the shielded identity.
export const walletProviders: WalletProvider[] = [
  {
    icon: WalletCardsIcon,
    id: "freighter",
    name: "Freighter",
  },
  {
    icon: ZapIcon,
    id: "xbull",
    name: "xBull",
  },
  {
    icon: ShellIcon,
    id: "lobstr",
    name: "LOBSTR",
  },
  {
    icon: KeyRoundIcon,
    id: "hana",
    name: "Hana Wallet",
  },
]
