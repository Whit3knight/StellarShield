"use client"

import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { ShieldedMarketPanel } from "./shielded-market/shielded-market-panel"

type MarketStackPanelProps = {
  account: ConnectedAccount | null
  market: MarketCardData
  onClose: () => void
}

/**
 * Selecting a market card opens this panel. The whole shielded borrow
 * lifecycle (deposit collateral → generate proof → sign borrow_shielded)
 * runs inline. Legacy receipt-registry flow (previously mounted via
 * DesktopMarketDrawer / MobileMarketDrawer) is retired.
 */
export function MarketStackPanel({
  account,
  market,
  onClose,
}: MarketStackPanelProps): React.ReactElement {
  return (
    <ShieldedMarketPanel account={account} market={market} onClose={onClose} />
  )
}
