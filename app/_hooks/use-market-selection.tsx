"use client"

import * as React from "react"

import type { MarketCardData } from "@/features/markets"

type SelectedMarketContextValue = {
  clearMarket: () => void
  selectMarket: (market: MarketCardData) => void
  selectedMarket: MarketCardData | null
}

const SelectedMarketContext =
  React.createContext<SelectedMarketContextValue | null>(null)

// ponytail: in-memory only; add localStorage rehydrate + cross-tab sync
// only when a user actually asks.
export function SelectedMarketProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [selectedMarket, setSelectedMarket] =
    React.useState<MarketCardData | null>(null)

  const selectMarket = React.useCallback((market: MarketCardData) => {
    setSelectedMarket(market)
  }, [])

  const clearMarket = React.useCallback(() => {
    setSelectedMarket(null)
  }, [])

  const value = React.useMemo<SelectedMarketContextValue>(
    () => ({ clearMarket, selectMarket, selectedMarket }),
    [clearMarket, selectMarket, selectedMarket]
  )

  return (
    <SelectedMarketContext.Provider value={value}>
      {children}
    </SelectedMarketContext.Provider>
  )
}

export function useMarketSelection(): SelectedMarketContextValue {
  const value = React.useContext(SelectedMarketContext)

  if (!value) {
    throw new Error(
      "useMarketSelection must be used within a SelectedMarketProvider"
    )
  }

  return value
}
