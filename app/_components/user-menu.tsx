"use client"

import {
  CreditCardIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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

import { userAppLinks, userResourceLinks } from "../_constants/user-menu-links"
import { PrivacyModeMenuItem } from "./privacy-mode-menu-item"
import { ThemeModeMenuItem } from "./theme-mode-menu-item"

export function UserMenu(): React.ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button aria-label="Open user menu" size="icon" variant="ghost" />
        }
      >
        <Avatar className="size-8">
          <AvatarFallback>SS</AvatarFallback>
        </Avatar>
      </MenuTrigger>
      <MenuPopup align="end" className="w-56">
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
        <MenuItem closeOnClick variant="destructive">
          <LogOutIcon aria-hidden="true" />
          Disconnect
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
