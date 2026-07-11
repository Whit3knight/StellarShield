"use client"

import * as React from "react"

import { deriveShieldedIdentity } from "./memo"
import type { ScanIdentity } from "./scanner"

// Shielded identity is derived deterministically from the wallet
// address: SHA-256 the address bytes → seed → deriveShieldedIdentity.
// A cleaner scheme signs a canonical message via Freighter, but that
// requires a wallet popup on every fresh page load — bad UX for a
// derivation that doesn't need to leave the browser.

/**
 * Hook returning the connected wallet's shielded identity. `null`
 * when no wallet is connected.
 */
export function useShieldedIdentity(
  account: string | null
): ScanIdentity | null {
  const [identity, setIdentity] = React.useState<ScanIdentity | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!account) {
        setIdentity(null)
        return
      }
      const seed = await deriveSeedFromAddress(account)
      if (cancelled) return
      const { publicKey, secretKey } = deriveShieldedIdentity(seed)
      const skField = bytesToBigInt(secretKey)
      setIdentity({ publicKey, secretKey, skField })
    })()
    return () => {
      cancelled = true
    }
  }, [account])

  return identity
}

/**
 * Also exposed as a plain async helper for non-React consumers (e.g.
 * background scanners triggered from the borrow-events bus).
 */
export async function shieldedIdentityFromAddress(
  account: string
): Promise<ScanIdentity> {
  const seed = await deriveSeedFromAddress(account)
  const { publicKey, secretKey } = deriveShieldedIdentity(seed)
  return { publicKey, secretKey, skField: bytesToBigInt(secretKey) }
}

async function deriveSeedFromAddress(address: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(`stellar-shield:${address}`)
  const buffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  ) as ArrayBuffer
  const hash = await crypto.subtle.digest("SHA-256", buffer)
  return new Uint8Array(hash)
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
