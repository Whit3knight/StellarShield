"use client"

import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import {
  getMarketPair,
  marketCards,
  type MarketCardData,
} from "@/features/markets"

const MARKET_QUERY_PARAM = "market"

export function useMarketSelection(): {
  clearMarket: () => void
  selectMarket: (market: MarketCardData) => void
  selectedMarket: MarketCardData | null
} {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawParam = searchParams.get(MARKET_QUERY_PARAM)

  const selectedMarket = React.useMemo(() => {
    if (!rawParam) return null

    return (
      marketCards.find((market) => getMarketPair(market) === rawParam) ?? null
    )
  }, [rawParam])

  const selectMarket = React.useCallback(
    (market: MarketCardData) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set(MARKET_QUERY_PARAM, getMarketPair(market))
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const clearMarket = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(MARKET_QUERY_PARAM)
    const query = next.toString()
    router.replace(query ? `?${query}` : "?", { scroll: false })
  }, [router, searchParams])

  return { clearMarket, selectMarket, selectedMarket }
}
