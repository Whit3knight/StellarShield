"use client"

import {
  ArrowUpRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  LogOutIcon,
  WalletCardsIcon,
} from "lucide-react"
import * as React from "react"

import { WalletIdentityHeader } from "@/components/molecules/wallet-identity-header"
import { Button } from "@/components/ui/button"
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@/components/ui/menu"
import { getStellarExpertAccountUrl } from "@/features/wallet/network"

import type { ConnectedAccount } from "../_constants/account"
import { userAppLinks, userResourceLinks } from "../_constants/user-menu-links"
import { useNavMenus } from "../_hooks/use-nav-menus"
import { PrivacyModeMenuItem } from "./privacy-mode-menu-item"
import { ThemeModeMenuItem } from "./theme-mode-menu-item"

export function UserMenu({
  account,
  onDisconnect,
}: {
  account: ConnectedAccount
  onDisconnect: () => void
}): React.ReactElement {
  const { walletMenu } = useNavMenus()
  const explorerUrl = getStellarExpertAccountUrl(account.wallet.address)

  const handleCopyAddress = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return

    void navigator.clipboard.writeText(account.wallet.address)
  }, [account.wallet.address])

  return (
    <Menu onOpenChange={walletMenu.setOpen} open={walletMenu.open}>
      <MenuTrigger
        render={
          <Button aria-label="Open wallet menu" size="icon" variant="ghost" />
        }
      >
        <WalletCardsIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel className="p-0">
            <WalletIdentityHeader account={account} />
          </MenuGroupLabel>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Wallet</MenuGroupLabel>
          <MenuItem closeOnClick onClick={handleCopyAddress}>
            <CopyIcon aria-hidden="true" />
            Copy address
          </MenuItem>
          <MenuLinkItem href={explorerUrl} rel="noreferrer" target="_blank">
            <ExternalLinkIcon aria-hidden="true" />
            View on Stellar Expert
            <MenuShortcut
              aria-hidden="true"
              className="tracking-normal [&>svg]:size-3.5"
            >
              <ArrowUpRightIcon />
            </MenuShortcut>
          </MenuLinkItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>App</MenuGroupLabel>
          {userAppLinks.map((link) => {
            const Icon = link.icon

            return (
              <MenuLinkItem href={link.href} key={link.label}>
                <Icon aria-hidden="true" />
                {link.label}
              </MenuLinkItem>
            )
          })}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Resources</MenuGroupLabel>
          {userResourceLinks.map((link) => {
            const Icon = link.icon

            return (
              <MenuLinkItem href={link.href} key={link.label}>
                <Icon aria-hidden="true" />
                {link.label}
                <MenuShortcut
                  aria-hidden="true"
                  className="tracking-normal [&>svg]:size-3.5"
                >
                  <ArrowUpRightIcon />
                </MenuShortcut>
              </MenuLinkItem>
            )
          })}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Preferences</MenuGroupLabel>
          <ThemeModeMenuItem />
          <PrivacyModeMenuItem />
        </MenuGroup>
        <MenuSeparator />
        <MenuItem closeOnClick onClick={onDisconnect} variant="destructive">
          <LogOutIcon aria-hidden="true" />
          Disconnect
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
