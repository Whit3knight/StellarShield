"use client"

import { useAssetPriceRefresher } from "./use-asset-prices"

/**
 * Mounts `useAssetPriceRefresher` from the (server) root layout —
 * the hook needs a client boundary, the layout doesn't otherwise need
 * one. Renders nothing.
 */
export function AssetPriceRefresher(): null {
  useAssetPriceRefresher()
  return null
}
