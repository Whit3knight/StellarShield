"use client"

import * as React from "react"

import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

export type RateParams = {
  baseAprBps: number
  reserveFactorBps: number
  secondsPerYear: number
  slopeAprBps: number
}

/** Fallback matches live testnet `rate_params()`, verified 2026-08-20. */
const FALLBACK: RateParams = {
  baseAprBps: 200,
  reserveFactorBps: 1000,
  secondsPerYear: 31_536_000,
  slopeAprBps: 1500,
}

let cached: RateParams | null = null
let inflight: Promise<RateParams> | null = null

async function loadRateParams(): Promise<RateParams> {
  if (cached) return cached
  if (inflight) return inflight

  const contractId = getConfiguredContractId()
  if (!contractId) {
    cached = FALLBACK
    return FALLBACK
  }

  inflight = (async () => {
    try {
      const bindings = await import("./bindings/borrow-pool")
      const client = new bindings.Client({
        contractId,
        networkPassphrase: getConfiguredNetworkPassphrase(),
        rpcUrl: getConfiguredSorobanRpcUrl(),
      })
      const tx = await client.rate_params()
      const result = tx.result
      if (!result) {
        cached = FALLBACK
        return FALLBACK
      }
      const params: RateParams = {
        baseAprBps: Number(result.base_apr_bps),
        reserveFactorBps: Number(result.reserve_factor_bps),
        secondsPerYear: Number(result.seconds_per_year),
        slopeAprBps: Number(result.slope_apr_bps),
      }
      cached = params
      return params
    } catch {
      cached = FALLBACK
      return FALLBACK
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Await current rate params (contract-fetched, cached module-wide). */
export async function getRateParams(): Promise<RateParams> {
  return loadRateParams()
}

/**
 * Reactive hook. Returns cached params immediately when available; on
 * first call it fires the fetch and re-renders on completion. Callers
 * that need synchronous access before the fetch resolves get the
 * fallback (matches the live-verified contract values).
 */
export function useRateParams(): RateParams {
  const [params, setParams] = React.useState<RateParams>(cached ?? FALLBACK)
  React.useEffect(() => {
    let cancelled = false
    loadRateParams().then((next) => {
      if (!cancelled) setParams(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return params
}
