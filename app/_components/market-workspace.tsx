"use client"

import * as React from "react"

import {
  getMarketPair,
  marketCards,
  type MarketCardData,
} from "@/features/markets"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"
import { getMarketWalletBalance } from "@/features/wallet/utils"

import { MarketCard } from "./market-card"
import { MarketStackPanel } from "./market-stack-panel"

export function MarketWorkspace(): React.ReactElement {
  const { account } = useWalletConnection()
  const [selectedMarket, setSelectedMarket] =
    React.useState<MarketCardData | null>(null)
  const selectedMarketPair = selectedMarket
    ? getMarketPair(selectedMarket)
    : null

  return (
    <div
      className={
        selectedMarket
          ? "grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]"
          : "grid h-full min-h-0"
      }
    >
      <section
        className="min-h-0 min-w-0 scrollbar-none overflow-y-auto p-4 md:p-6"
        id="markets"
      >
        <div>
          <h1 className="text-xl font-semibold">Markets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse all public markets, then pick one to start a borrow flow.
          </p>
        </div>
        <div
          className={
            selectedMarket
              ? "mt-4 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3"
              : "mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          }
        >
          {marketCards.map((market) => {
            const marketPair = getMarketPair(market)

            return (
              <MarketCard
                active={selectedMarketPair === marketPair}
                key={marketPair}
                market={market}
                onViewMarket={() => {
                  setSelectedMarket(market)
                }}
                yourBalance={getMarketWalletBalance(account, market)}
              />
            )
          })}
        </div>
      </section>

      {selectedMarket ? (
        <MarketStackPanel
          account={account}
          key={selectedMarketPair}
          market={selectedMarket}
          onClose={() => {
            setSelectedMarket(null)
          }}
        />
      ) : null}
    </div>
  )
}
