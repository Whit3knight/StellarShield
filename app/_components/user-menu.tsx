"use client"

import {
  ActivityIcon,
  ArrowUpRightIcon,
  ExternalLinkIcon,
  LogOutIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

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
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu"
import { WalletDetailPanel } from "@/components/organisms/wallet-detail-panel"
import { getStellarExpertAccountUrl } from "@/features/wallet/network"

import type { ConnectedAccount } from "../_constants/account"
import { userResourceLinks } from "../_constants/user-menu-links"
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
  const { activityDrawer, proofsDrawer, walletMenu } = useNavMenus()
  const explorerUrl = getStellarExpertAccountUrl(account.wallet.address)

  return (
    <Menu onOpenChange={walletMenu.setOpen} open={walletMenu.open}>
      <MenuTrigger
        data-tour="wallet"
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
          <MenuSub>
            <MenuSubTrigger>
              <WalletIcon aria-hidden="true" />
              Wallet
            </MenuSubTrigger>
            <MenuSubPopup className="w-80">
              <WalletDetailPanel
                account={account}
                onClose={() => walletMenu.setOpen(false)}
                onDisconnect={onDisconnect}
              />
            </MenuSubPopup>
          </MenuSub>
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
          <MenuItem
            closeOnClick
            onClick={() => proofsDrawer.setOpen(true)}
          >
            <ShieldCheckIcon aria-hidden="true" />
            Proofs
          </MenuItem>
          <MenuItem
            closeOnClick
            onClick={() => activityDrawer.setOpen(true)}
          >
            <ActivityIcon aria-hidden="true" />
            Activity
          </MenuItem>
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
