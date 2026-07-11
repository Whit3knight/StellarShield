"use client"

import * as React from "react"

import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

export type RiskParams = {
  hfMinBps: number
  liquidationBonusBps: number
  liquidationThresholdBps: number
  maxLtvBps: number
}

/** Fallback matches the contract-side defaults set in `initialize_shielded`. */
const FALLBACK: RiskParams = {
  hfMinBps: 12_500,
  liquidationBonusBps: 500,
  liquidationThresholdBps: 8_500,
  maxLtvBps: 6_250,
}

let cached: RiskParams | null = null
let inflight: Promise<RiskParams> | null = null

async function loadRiskParams(): Promise<RiskParams> {
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
      const tx = await client.risk_params()
      const result = tx.result
      if (!result) {
        cached = FALLBACK
        return FALLBACK
      }
      const params: RiskParams = {
        hfMinBps: Number(result.hf_min_bps),
        liquidationBonusBps: Number(result.liquidation_bonus_bps),
        liquidationThresholdBps: Number(result.liquidation_threshold_bps),
        maxLtvBps: Number(result.max_ltv_bps),
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

/** Await current risk params (contract-fetched, cached module-wide). */
export async function getRiskParams(): Promise<RiskParams> {
  return loadRiskParams()
}

/**
 * Reactive hook. Returns cached params immediately when available; on
 * first call it fires the fetch and re-renders on completion. Callers
 * that need synchronous access before the fetch resolves get the
 * fallback (matches contract defaults, safe to prove against).
 */
export function useRiskParams(): RiskParams {
  const [params, setParams] = React.useState<RiskParams>(
    cached ?? FALLBACK
  )
  React.useEffect(() => {
    let cancelled = false
    loadRiskParams().then((next) => {
      if (!cancelled) setParams(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return params
}
