"use client"

import * as React from "react"

import {
  snapshotAssetPrices,
  subscribeAssetPrices,
  writeCachedAssetPrice,
} from "./price-cache"
import { fetchReflectorPrice, reflectorPriceToUsd } from "./prices"
import type { SupportedAssetSymbol } from "./types"

const REFRESH_MS = 20_000
const SYMBOLS: SupportedAssetSymbol[] = ["USDC", "XLM", "EURC"]

/**
 * Fires-and-forgets a Reflector fetch for every supported asset,
 * pushing results into the shared price cache. Mount once at the app
 * root — `getAssetPriceUsd` readers pick up updates via the cache.
 */
export function useAssetPriceRefresher(): void {
  React.useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    const refresh = async () => {
      await Promise.all(
        SYMBOLS.map(async (symbol) => {
          try {
            const record = await fetchReflectorPrice(symbol, controller.signal)
            if (record) {
              writeCachedAssetPrice(symbol, reflectorPriceToUsd(record))
            }
          } catch {
            // ignore — cache keeps last-known value
          }
        })
      )
    }

    void refresh()

    const interval = window.setInterval(() => {
      if (disposed || document.visibilityState === "hidden") return
      void refresh()
    }, REFRESH_MS)

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
}

/**
 * React hook wrapping the price cache so consumers can rerender when
 * Reflector updates land. Returns the same object shape as
 * `assetPricesUsd` — always populated with numbers, never null.
 */
export function useAssetPrices(): Record<SupportedAssetSymbol, number> {
  return React.useSyncExternalStore(
    subscribeAssetPrices,
    snapshotAssetPrices,
    snapshotAssetPrices
  )
}
