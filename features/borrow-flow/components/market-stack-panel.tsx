"use client"

import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/app/_constants/dashboard"

import { useIsDesktop } from "../hooks/use-is-desktop"
import { DesktopMarketDrawer } from "./drawer/desktop-market-drawer"
import { MobileMarketDrawer } from "./drawer/mobile-market-drawer"

type MarketStackPanelProps = {
  account: ConnectedAccount | null
  market: MarketCardData
  onClose: () => void
}

export function MarketStackPanel({
  account,
  market,
  onClose,
}: MarketStackPanelProps): React.ReactElement {
  const isDesktop = useIsDesktop()

  if (!isDesktop) {
    return (
      <MobileMarketDrawer account={account} market={market} onClose={onClose} />
    )
  }

  return (
    <DesktopMarketDrawer account={account} market={market} onClose={onClose} />
  )
}
