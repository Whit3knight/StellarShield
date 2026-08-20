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

/**
 * Fixed note size per asset, in RAW token units (stroops). All three
 * SACs are 7-decimal, so these are 1 XLM, 0.5 USDC, 0.5 EURC. Mirrors
 * `DENOMINATION_*` in `contracts/borrow-pool/src/notes.rs` — the
 * contract rejects any deposit whose transferred amount differs.
 */
export const DENOMINATION: Record<ShieldedAsset, bigint> = {
  EURC: 5_000_000n,
  USDC: 5_000_000n,
  XLM: 10_000_000n,
}

/**
 * Fixed by the shielded-borrow circuit (compiled with 4 collateral
 * inputs). Changing this value requires a new circuit + trusted setup,
 * so callers import the constant instead of hardcoding 4 in string
 * templates or eligibility filters that would drift silently.
 */
export const COLLATERAL_NOTES_PER_BORROW = 4

export type NoteTree = "deposit" | "loan"

export type ShieldedNote = {
  amount: bigint
  asset: ShieldedAsset
  index: number
  salt: bigint
  sk: bigint
  tree: NoteTree
  /** Unix seconds. Sourced from the mint event's ledgerCloseTime. */
  openedAt?: number
  /**
   * Liquidation-bond openings decrypted from the borrow memo. Only
   * present on loan notes minted by a Track-L-aware borrow. A
   * liquidator (or the borrower themselves for self-check) uses these
   * to feed the liquidate circuit.
   */
  bond?: {
    saltAmount: bigint
    saltValue: bigint
    saltPrice: bigint
    collateralValue: bigint
    /**
     * Reflector price of `collateralAsset` at the moment of borrow,
     * scaled to the oracle's native precision. Field name is legacy —
     * it is the collateral asset's price, not the borrow asset's.
     */
    borrowPrice: bigint
    /**
     * Asset the collateral notes are denominated in. Optional for
     * legacy loan notes minted before this field was memoised; the HF
     * badge falls back to the loan asset in that case, which is only
     * correct when collateral and loan share an asset.
     */
    collateralAsset?: ShieldedAsset
  }
  /**
   * Marked once this note's nullifier is seen on-chain (or locally
   * right after a successful spend). Spent notes are kept — not
   * dropped — because their commitments backfill Merkle tree rebuilds
   * after the enabling events expire from RPC retention.
   */
  spent?: boolean
  /**
   * Merkle inclusion witness cached at deposit-time. Populated by
   * `prepareDeposit` after it fetches the pre-tx `deposit_frontier`
   * from the contract. Downstream spend paths (borrow / withdraw /
   * repay) prefer this over the event-replay fallback in
   * `fetchDepositWitnesses`, which silently fails once the
   * enabling deposit event ages past Soroban's ~24h retention.
   */
  witness?: {
    pathElements: bigint[]
    pathBits: number[]
    root: bigint
  }
}

/**
 * True when a note is no longer spendable. `amount === 0n` covers
 * legacy local tombstones written before the `spent` flag existed.
 */
export function isSpentNote(
  note: Pick<ShieldedNote, "amount" | "spent">
): boolean {
  return note.spent === true || note.amount === 0n
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
