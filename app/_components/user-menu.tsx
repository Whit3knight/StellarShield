"use client"

import {
  ArrowUpRightIcon,
  ExternalLinkIcon,
  LogOutIcon,
  WalletCardsIcon,
  WalletIcon,
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
import { WalletDetailDialog } from "@/components/organisms/wallet-detail-dialog"
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
  const { walletDetail, walletMenu } = useNavMenus()
  const explorerUrl = getStellarExpertAccountUrl(account.wallet.address)

  const handleOpenWalletDetail = React.useCallback(() => {
    walletDetail.setOpen(true)
  }, [walletDetail])

  return (
    <>
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
            <MenuItem closeOnClick onClick={handleOpenWalletDetail}>
              <WalletIcon aria-hidden="true" />
              Wallet
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
      <WalletDetailDialog
        account={account}
        onDisconnect={onDisconnect}
        onOpenChange={walletDetail.setOpen}
        open={walletDetail.open}
      />
    </>
  )
}
