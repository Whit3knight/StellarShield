#!/usr/bin/env bun
/**
 * Generates the X25519 keypair the liquidation service uses.
 *
 *   sk = SHA-256(seed)         (feeds LIQUIDATION_SERVICE_SK env)
 *   pk = X25519.getPublicKey(sk)   (fed to set_liquidation_service_pk)
 *
 * `SEED` env, if set, is base64 or 32-byte hex — reproducible key.
 * Otherwise a fresh 32-byte random seed is drawn.
 *
 * Outputs sk + pk hex, plus the exact `stellar contract invoke`
 * command the deployer can paste to publish the pk into the
 * LiquidationServicePk instance-storage slot on the pool.
 */

import { randomBytes } from "node:crypto"

import { x25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"

const CONTRACT =
  process.env.STELLAR_SHIELD_CONTRACT_ID ??
  process.env.NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID ??
  "CBLTPN2JCUHYH35OFGAYQ3NJDJC66IMFPHLOBT6PI2XKNVKPNH4FS6I4"

function loadSeed(): Uint8Array {
  const raw = process.env.SEED?.trim()
  if (!raw) return new Uint8Array(randomBytes(32))
  if (raw.startsWith("0x") || /^[0-9a-fA-F]+$/.test(raw)) {
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw
    if (hex.length !== 64) {
      throw new Error(`SEED hex must be 32 bytes; got ${hex.length / 2}`)
    }
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
  // Treat as base64.
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error(`SEED base64 must decode to 32 bytes; got ${buf.length}`)
  }
  return new Uint8Array(buf)
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function main(): void {
  const seed = loadSeed()
  const sk = sha256(seed)
  const pk = x25519.getPublicKey(sk)

  console.log("# X25519 liquidation service keypair")
  console.log("# Match `deriveShieldedIdentity(seed)` in features/notes/memo.ts")
  console.log(`seed_hex=${toHex(seed)}`)
  console.log(`sk_hex=${toHex(sk)}`)
  console.log(`pk_hex=${toHex(pk)}`)
  console.log("")
  console.log("# Env for authenticated scan-underwater:")
  console.log(`export LIQUIDATION_SERVICE_SK=0x${toHex(sk)}`)
  console.log("")
  console.log("# Deploy pk to contract (admin auth required):")
  console.log(
    `stellar contract invoke --source deployer --network testnet --id ${CONTRACT} -- set_liquidation_service_pk --pk ${toHex(pk)}`
  )
}

main()
