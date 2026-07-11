// Shielded pool note primitives — client-side commitment + nullifier
// derivation. The chain sees only Poseidon outputs (opaque field
// elements); this module keeps everything the user needs to reproduce
// the same outputs from their secret key.
//
// Shape:
//   commitment  = Poseidon(amount, asset_tag, sk, salt)
//   nullifier   = Poseidon(sk, index)
//
// Uses the BLS12-381 Fr Poseidon in ./poseidon.ts, which mirrors the
// circom circuits compiled with `-p bls12381` and the Rust contract
// port at `contracts/borrow-pool/src/poseidon.rs`. Any drift between
// the three copies breaks every proof.

import { FR_ORDER, poseidon } from "./poseidon"

export const SUPPORTED_ASSETS = ["XLM", "USDC", "EURC"] as const
export type ShieldedAsset = (typeof SUPPORTED_ASSETS)[number]

export const DENOMINATION: Record<ShieldedAsset, bigint> = {
  EURC: 10n,
  USDC: 10n,
  XLM: 100n,
}

export type NoteTree = "deposit" | "loan"

export type ShieldedNote = {
  amount: bigint
  asset: ShieldedAsset
  index: number
  salt: bigint
  sk: bigint
  tree: NoteTree
}

/**
 * Numeric tag identifying the asset inside a commitment. Fixed per
 * asset so the circuit can constrain "commitment.asset_tag matches
 * declared deposit asset" without embedding a string in the circuit.
 */
export function assetTag(asset: ShieldedAsset): bigint {
  const index = SUPPORTED_ASSETS.indexOf(asset)
  if (index < 0) throw new Error(`Unknown asset: ${asset}`)
  return BigInt(index)
}

/**
 * Commitment for a shielded note. Contract stores this in the tree;
 * chain observers can't invert it back to `{ amount, asset, sk, salt }`
 * because Poseidon is one-way.
 */
export function computeCommitment(
  note: Pick<ShieldedNote, "amount" | "asset" | "sk" | "salt">
): bigint {
  return poseidon([note.amount, assetTag(note.asset), note.sk, note.salt])
}

/**
 * Nullifier used to mark a note as spent. Contract stores nullifiers
 * globally; any second attempt to spend the same note is rejected.
 * Derived from `sk` so only the owner can compute it.
 */
export function computeNullifier(sk: bigint, index: number): bigint {
  return poseidon([sk, BigInt(index)])
}

/**
 * Cryptographically random field element for salt / secret key seeding.
 * Uses the platform crypto API — never `Math.random`.
 */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  // Clamp so the result is < r. Rejection sampling would be cleaner
  // but this bias is negligible for salts.
  return value % FR_ORDER
}
