"use client"

import {
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
  WalletCardsIcon,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu"

import type { ConnectedAccount } from "../_constants/account"
import { userAppLinks, userResourceLinks } from "../_constants/user-menu-links"
import { PrivacyModeMenuItem } from "./privacy-mode-menu-item"
import { ThemeModeMenuItem } from "./theme-mode-menu-item"

export function UserMenu({
  account,
  onDisconnect,
}: {
  account: ConnectedAccount
  onDisconnect: () => void
}): React.ReactElement {
  const [copiedAddress, setCopiedAddress] = React.useState(false)

  React.useEffect(() => {
    if (!copiedAddress) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopiedAddress(false)
    }, 1200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [copiedAddress])

  const handleCopyAddress = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      try {
        await navigator.clipboard.writeText(account.wallet.address)
        setCopiedAddress(true)
      } catch {
        setCopiedAddress(false)
      }
    },
    [account.wallet.address]
  )

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button aria-label="Open wallet menu" size="icon" variant="ghost" />
        }
      >
        <WalletCardsIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel className="flex items-start justify-between gap-3 px-2 py-2 text-left">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {account.wallet.shortAddress}
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {account.wallet.balance}
              </span>
            </span>
            <Button
              aria-label={
                copiedAddress ? "Wallet address copied" : "Copy wallet address"
              }
              className="-me-1 mt-0.5"
              onClick={handleCopyAddress}
              size="icon-sm"
              title={copiedAddress ? "Copied" : "Copy address"}
              variant="ghost"
            >
              {copiedAddress ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
            </Button>
          </MenuGroupLabel>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Account</MenuGroupLabel>
          <MenuItem closeOnClick>
            <UserIcon aria-hidden="true" />
            Wallet
          </MenuItem>
          <MenuItem closeOnClick>
            <CreditCardIcon aria-hidden="true" />
            Positions
          </MenuItem>
          <MenuItem closeOnClick>
            <SettingsIcon aria-hidden="true" />
            Settings
          </MenuItem>
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
