import { assets } from "./data"
import type { SupportedAssetSymbol } from "./types"

// Static hardcodes stay as the initial fallback so first render (before
// Reflector responds) doesn't show $0.00. The hook overwrites entries
// as real oracle values arrive.
const cache: Record<SupportedAssetSymbol, number> = {
  EURC: assets.EURC.priceUsd,
  USDC: assets.USDC.priceUsd,
  XLM: assets.XLM.priceUsd,
}

// Frozen snapshot returned by snapshotAssetPrices. React's
// useSyncExternalStore compares snapshots via Object.is; returning a
// fresh { ...cache } literal on every call schedules a re-render each
// commit and loops. Rebuild the snapshot only when a price actually
// changes.
let snapshot: Record<SupportedAssetSymbol, number> = { ...cache }

const listeners = new Set<() => void>()

export function readCachedAssetPrice(symbol: SupportedAssetSymbol): number {
  return cache[symbol]
}

export function writeCachedAssetPrice(
  symbol: SupportedAssetSymbol,
  price: number
): void {
  if (cache[symbol] === price) return
  cache[symbol] = price
  snapshot = { ...cache }
  for (const listener of listeners) listener()
}

export function subscribeAssetPrices(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function snapshotAssetPrices(): Record<SupportedAssetSymbol, number> {
  return snapshot
}
