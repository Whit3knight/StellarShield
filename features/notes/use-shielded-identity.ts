"use client"

import * as React from "react"

import { getConfiguredNetworkPassphrase } from "@/features/wallet/network"

import { deriveShieldedIdentity } from "./memo"
import type { ScanIdentity } from "./scanner"

// R1: the shielded identity (which is ALSO the note spending key) is
// derived from a Freighter signature — a secret input — not from the
// public wallet address. A canonical message is signed once per browser
// profile; the resulting 32-byte seed is cached in localStorage so the
// popup does not reappear on every page load. The cached seed is secret
// material that cannot be recomputed from public data, unlike the old
// address-derived scheme (see legacyIdentityFromAddress) which anyone
// could reproduce from a G-address.

const IDENTITY_MESSAGE = (networkPassphrase: string): string =>
  [
    "Stellar Shield: derive shielded identity (v2).",
    `Network: ${networkPassphrase}`,
    "Signing proves wallet ownership to encrypt your private notes.",
    "Only sign this on the Stellar Shield app you trust.",
  ].join("\n")

const cacheKey = (account: string): string =>
  `stellar-shield:identity:v2:${account}`

/**
 * Hook returning the connected wallet's shielded identity. `null` while
 * no wallet is connected, the signature is pending, or the user declined
 * to sign (the app cannot mint or spend notes without it — that is the
 * privacy guarantee, not a bug).
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
      try {
        const seed = await resolveSeed(account)
        if (cancelled) return
        setIdentity(identityFromSeed(seed))
      } catch (err) {
        if (!cancelled) {
          console.error("[identity] failed to derive shielded identity", err)
          setIdentity(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account])

  return identity
}

/**
 * The pre-R1 identity derived from the public wallet address. Retained
 * ONLY so notes minted before the migration still decrypt and spend;
 * never use it to mint new notes. Passed to the scanner as a legacy
 * fallback identity.
 */
export async function legacyIdentityFromAddress(
  account: string
): Promise<ScanIdentity> {
  const seed = await deriveSeedFromAddress(account)
  return identityFromSeed(seed)
}

/**
 * Erase the cached seed for `account`. Non-destructive: the signed
 * message carries no nonce or timestamp and Ed25519 signatures are
 * deterministic (RFC 8032), so re-signing with the same wallet
 * regenerates a byte-identical seed.
 *
 * ponytail: clears the named account only. A wallet connected earlier
 * in this browser profile keeps its seed — sweep the
 * `stellar-shield:identity:v2:` prefix if multi-account matters.
 */
export function forgetShieldedIdentity(account: string): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(cacheKey(account))
}

function identityFromSeed(seed: Uint8Array): ScanIdentity {
  const { publicKey, secretKey } = deriveShieldedIdentity(seed)
  return { publicKey, secretKey, skField: bytesToBigInt(secretKey) }
}

async function resolveSeed(account: string): Promise<Uint8Array> {
  const cached = readCachedSeed(account)
  if (cached) return cached

  const seed = await deriveSeedFromSignature(account)
  writeCachedSeed(account, seed)
  return seed
}

async function deriveSeedFromSignature(account: string): Promise<Uint8Array> {
  const passphrase = getConfiguredNetworkPassphrase()
  const { signMessage } = await import("@stellar/freighter-api")
  const result = await signMessage(IDENTITY_MESSAGE(passphrase), {
    address: account,
  })
  if (result.error || !result.signedMessage) {
    throw new Error(
      `Freighter signMessage failed: ${result.error?.message ?? "no signature returned"}`
    )
  }
  const sig = signatureToBytes(result.signedMessage)
  const buffer = sig.buffer.slice(
    sig.byteOffset,
    sig.byteOffset + sig.byteLength
  ) as ArrayBuffer
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))
}

// Freighter V3 returns a Buffer, V4 a base64 string; normalize to bytes.
function signatureToBytes(signed: Uint8Array | string): Uint8Array {
  if (typeof signed !== "string") return new Uint8Array(signed)
  const binary = atob(signed)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function readCachedSeed(account: string): Uint8Array | null {
  if (typeof window === "undefined") return null
  const hex = window.localStorage.getItem(cacheKey(account))
  if (!hex || hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function writeCachedSeed(account: string, seed: Uint8Array): void {
  if (typeof window === "undefined") return
  const hex = Array.from(seed)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  window.localStorage.setItem(cacheKey(account), hex)
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
