import type { LucideIcon } from "lucide-react"
import { KeyRoundIcon, ShellIcon, WalletCardsIcon, ZapIcon } from "lucide-react"

export type WalletProviderId = "freighter" | "hana" | "lobstr" | "xbull"

export type WalletProvider = {
  /** Official brand accent, background of the connect button. */
  brandColor: string
  /**
   * Text/icon color against `brandColor`. Not always white — xBull's
   * lavender and LOBSTR's cyan fail WCAG AA (>=4.5:1) with white text
   * (2.23:1 and 2.54:1 measured), so those get the app's own dark
   * neutral instead. Computed once, not derived at render time.
   */
  brandForeground: string
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
// brandColor is each wallet's own accent, read from their live
// production stylesheet, not guessed:
//   Freighter  #7b68ff  --color-accent in freighter.app's compiled CSS
//   xBull      #c19cfc  dominant color in wallet.xbull.app's CSS (169
//              occurrences); matches stellarwalletskit.dev's own theme
//              example, unsurprising since Creit Tech built both
//   LOBSTR     #00abff  dominant color in lobstr.co's compiled CSS
//   Hana       #6256e9  base of Hana's own button gradient
//              (linear-gradient(135deg,#6257E9,#B76BD9)) on hana.money
//              (hanawallet.io redirects there)
export const walletProviders: WalletProvider[] = [
  {
    brandColor: "#7b68ff",
    brandForeground: "#111827",
    icon: WalletCardsIcon,
    id: "freighter",
    name: "Freighter",
  },
  {
    brandColor: "#c19cfc",
    brandForeground: "#111827",
    icon: ZapIcon,
    id: "xbull",
    name: "xBull",
  },
  {
    brandColor: "#00abff",
    brandForeground: "#111827",
    icon: ShellIcon,
    id: "lobstr",
    name: "LOBSTR",
  },
  {
    brandColor: "#6256e9",
    brandForeground: "#ffffff",
    icon: KeyRoundIcon,
    id: "hana",
    name: "Hana Wallet",
  },
]
