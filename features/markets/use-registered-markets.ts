"use client"

import * as React from "react"

import { chainMarketPairKey, fetchRegisteredMarkets } from "./chain-markets"

type State = {
  isLoading: boolean
  pairs: Set<string> | null
}

const INITIAL: State = { isLoading: true, pairs: null }

let cache: Set<string> | null = null
let inFlight: Promise<Set<string>> | null = null

async function loadOnce(signal?: AbortSignal): Promise<Set<string>> {
  if (cache) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    const markets = await fetchRegisteredMarkets(signal)
    const set = new Set(markets.map(chainMarketPairKey))
    cache = set
    return set
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/**
 * Registered market pairs as reported by the contract's `list_markets`
 * view. `pairs` is `null` until the first fetch completes so callers
 * can distinguish "still loading" from "chain has none" — an empty set
 * means the contract is uninitialized or the network read failed, and
 * consumers should fall back to their hardcoded list rather than
 * showing zero markets.
 */
export function useRegisteredMarkets(): State {
  const [state, setState] = React.useState<State>(() =>
    cache ? { isLoading: false, pairs: cache } : INITIAL
  )

  React.useEffect(() => {
    if (state.pairs) return

    const controller = new AbortController()
    void (async () => {
      try {
        const pairs = await loadOnce(controller.signal)
        if (controller.signal.aborted) return
        setState({ isLoading: false, pairs })
      } catch {
        if (!controller.signal.aborted) setState({ isLoading: false, pairs: new Set() })
      }
    })()

    return () => controller.abort()
    // Fire once on mount — the module-level cache dedupes across
    // consumers, so re-running the effect on state changes would just
    // add churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
