"use client"

import * as React from "react"

import {
  onBorrowConfirmed,
  onRepayConfirmed,
} from "@/features/borrow-flow/borrow-events"

import { fetchMarketStats, type MarketStat } from "./market-stats"

const REFRESH_MS = 60_000

type State = {
  isLoading: boolean
  stats: Record<string, MarketStat>
}

let cache: Record<string, MarketStat> | null = null
const cacheListeners = new Set<() => void>()

async function refreshCache(signal?: AbortSignal): Promise<void> {
  const next = await fetchMarketStats(signal)
  if (signal?.aborted) return
  cache = next
  for (const listener of cacheListeners) listener()
}

/**
 * Contract-wide market activity aggregated from borrow + repay events.
 * Cached module-side so every card shares one fetch. Refreshes on a
 * 60s tick, whenever a borrow/repay confirmation lands, and when the
 * tab becomes visible after being hidden.
 */
export function useMarketStats(): State {
  const [state, setState] = React.useState<State>(() => ({
    isLoading: cache === null,
    stats: cache ?? {},
  }))

  React.useEffect(() => {
    let disposed = false
    const controller = new AbortController()

    const onCache = () => {
      if (disposed) return
      setState({ isLoading: false, stats: cache ?? {} })
    }
    cacheListeners.add(onCache)

    void (async () => {
      try {
        await refreshCache(controller.signal)
        if (disposed) return
        setState({ isLoading: false, stats: cache ?? {} })
      } catch {
        if (!disposed) setState({ isLoading: false, stats: cache ?? {} })
      }
    })()

    const interval = window.setInterval(() => {
      if (disposed || document.visibilityState === "hidden") return
      void refreshCache(controller.signal)
    }, REFRESH_MS)

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshCache(controller.signal)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    const offBorrow = onBorrowConfirmed(() =>
      void refreshCache(controller.signal)
    )
    const offRepay = onRepayConfirmed(() =>
      void refreshCache(controller.signal)
    )

    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
      offBorrow()
      offRepay()
      cacheListeners.delete(onCache)
    }
  }, [])

  return state
}
