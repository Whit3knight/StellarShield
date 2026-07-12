#!/usr/bin/env bun
/**
 * Generate an X25519 keypair for the liquidation service (Track A +
 * Track G-full). Prints:
 *   - service_sk_hex: 32-byte secret, distribute to the trusted
 *     service operator (env var LIQUIDATION_SERVICE_SK on the CLI).
 *   - service_pk_hex: 32-byte public key, publish on-chain via
 *     set_liquidation_service_pk so future borrows encrypt to it.
 *   - stellar invoke command that installs the pk on the deployed
 *     contract.
 *
 * Optional SEED env: deterministic keypair derivation. Same seed
 * always yields the same key. Omit for a cryptographically random
 * key.
 *
 * Usage:
 *   bun contracts/scripts/gen-service-key.ts
 *   SEED=my-org-liquidation-service-2026 bun contracts/scripts/gen-service-key.ts
 *   STELLAR_SHIELD_CONTRACT_ID=... bun contracts/scripts/gen-service-key.ts
 */

import { x25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"

const CONTRACT =
  process.env.STELLAR_SHIELD_CONTRACT_ID ??
  "CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L"
const ADMIN_KEY = process.env.ADMIN_KEY ?? "deployer"
const NETWORK = process.env.STELLAR_NETWORK ?? "testnet"

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function deriveSecret(): Uint8Array {
  const seed = process.env.SEED
  if (seed) {
    return sha256(new TextEncoder().encode(seed))
  }
  return x25519.utils.randomSecretKey()
}

const secretKey = deriveSecret()
const publicKey = x25519.getPublicKey(secretKey)

const skHex = toHex(secretKey)
const pkHex = toHex(publicKey)

console.log("Liquidation service X25519 keypair")
console.log("==================================")
console.log(`service_sk_hex : 0x${skHex}`)
console.log(`service_pk_hex : 0x${pkHex}`)
console.log("")
console.log("Distribute service_sk_hex to the trusted service operator:")
console.log(`  export LIQUIDATION_SERVICE_SK=0x${skHex}`)
console.log("")
console.log("Publish service_pk_hex on-chain via admin:")
console.log(
  `  stellar contract invoke --source ${ADMIN_KEY} --network ${NETWORK} \\
    --id ${CONTRACT} \\
    -- set_liquidation_service_pk --pk 0x${pkHex}`
)
