import type { LucideIcon } from "lucide-react"
import { KeyRoundIcon, ShellIcon, WalletCardsIcon, ZapIcon } from "lucide-react"

export type WalletProviderId = "freighter" | "hana" | "lobstr" | "xbull"

export type WalletProvider = {
  /** Background of the connect button. See note below on where this came from. */
  brandColor: string
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
//
// brandColor is each wallet's own accent — read from their live
// production stylesheet, not guessed — darkened 40% toward black so
// the button stays readable against the connect dialog's light
// background (the raw brand hex, especially xBull's pale lavender and
// LOBSTR's bright cyan, washed out against it) and so all four clear
// WCAG AA (>=4.5:1) with plain white text, letting the button drop the
// per-color foreground it used to need:
//   Freighter  raw #7b68ff -> #4a3e99  (--color-accent, freighter.app)
//   xBull      raw #c19cfc -> #745e97  (dominant in wallet.xbull.app's
//              CSS, 169 occurrences; matches stellarwalletskit.dev's
//              own theme example — unsurprising, Creit Tech built both)
//   LOBSTR     raw #00abff -> #006799  (dominant in lobstr.co's CSS)
//   Hana       raw #6256e9 -> #3b348c  (base of Hana's own button
//              gradient on hana.money; hanawallet.io redirects there)
export const walletProviders: WalletProvider[] = [
  {
    brandColor: "#4a3e99",
    icon: WalletCardsIcon,
    id: "freighter",
    name: "Freighter",
  },
  {
    brandColor: "#745e97",
    icon: ZapIcon,
    id: "xbull",
    name: "xBull",
  },
  {
    brandColor: "#006799",
    icon: ShellIcon,
    id: "lobstr",
    name: "LOBSTR",
  },
  {
    brandColor: "#3b348c",
    icon: KeyRoundIcon,
    id: "hana",
    name: "Hana Wallet",
  },
]
