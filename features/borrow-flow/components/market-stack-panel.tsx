"use client"

import type * as React from "react"

import type { MarketCardData } from "@/app/_constants/dashboard"

import { useIsDesktop } from "../hooks/use-is-desktop"
import { DesktopMarketDrawer } from "./drawer/desktop-market-drawer"
import { MobileMarketDrawer } from "./drawer/mobile-market-drawer"

type MarketStackPanelProps = {
  market: MarketCardData
  onClose: () => void
}

export function MarketStackPanel({
  market,
  onClose,
}: MarketStackPanelProps): React.ReactElement {
  const isDesktop = useIsDesktop()

  if (!isDesktop) {
    return <MobileMarketDrawer market={market} onClose={onClose} />
  }

  return <DesktopMarketDrawer market={market} onClose={onClose} />
}
