"use client"

import * as React from "react"

import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

let cached: Uint8Array | null | undefined
let inflight: Promise<Uint8Array | null> | null = null

/**
 * Fetch the liquidation-service X25519 pubkey configured on the pool
 * contract, or `null` if the admin hasn't published one yet. Cached
 * module-wide so the first call pays the RPC round trip and every
 * subsequent read returns instantly.
 */
export async function getLiquidationServicePk(): Promise<Uint8Array | null> {
  if (cached !== undefined) return cached
  if (inflight) return inflight

  const contractId = getConfiguredContractId()
  if (!contractId) {
    cached = null
    return null
  }

  inflight = (async () => {
    try {
      const bindings = await import("./bindings/borrow-pool")
      const client = new bindings.Client({
        contractId,
        networkPassphrase: getConfiguredNetworkPassphrase(),
        rpcUrl: getConfiguredSorobanRpcUrl(),
      })
      const tx = await client.liquidation_service_pk()
      const result = tx.result
      if (!result) {
        cached = null
        return null
      }
      const bytes = normalizeBytes(result)
      cached = bytes
      return bytes
    } catch {
      cached = null
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Reactive hook. Returns the cached pubkey when available; on first
 * call fires the fetch and re-renders on completion. `undefined` while
 * loading, `null` when no service configured, `Uint8Array` when set.
 */
export function useLiquidationServicePk(): Uint8Array | null | undefined {
  const [pk, setPk] = React.useState<Uint8Array | null | undefined>(
    cached === undefined ? undefined : cached
  )
  React.useEffect(() => {
    let cancelled = false
    getLiquidationServicePk().then((next) => {
      if (!cancelled) setPk(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return pk
}

function normalizeBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return bytes
  }
  throw new Error("liquidation_service_pk: unrecognised bytes shape")
}
