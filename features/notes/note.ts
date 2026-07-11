// Shielded pool note primitives — client-side commitment + nullifier
// derivation. The chain sees only Poseidon outputs (opaque field
// elements); this module keeps everything the user needs to reproduce
// the same outputs from their secret key.
//
// Shape:
//   commitment  = Poseidon(amount, asset_tag, sk, salt)
//   nullifier   = Poseidon(sk, index)
//
// Circuits mirror this exact hash layout — see Track Z circom sources.
// Any drift breaks every proof.

// @ts-expect-error — circomlibjs ships no TS types.
import { buildPoseidon } from "circomlibjs"

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

// Poseidon over the same field the circuit uses. `circomlibjs` returns
// values as byte arrays; we normalize to `bigint` for downstream code.
type PoseidonInstance = {
  F: { toObject: (value: unknown) => bigint }
  (inputs: bigint[]): unknown
}

let poseidonCache: Promise<PoseidonInstance> | null = null

async function getPoseidon(): Promise<PoseidonInstance> {
  if (!poseidonCache) {
    poseidonCache = buildPoseidon() as Promise<PoseidonInstance>
  }
  return poseidonCache
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
export async function computeCommitment(
  note: Pick<ShieldedNote, "amount" | "asset" | "sk" | "salt">
): Promise<bigint> {
  const poseidon = await getPoseidon()
  const raw = poseidon([
    note.amount,
    assetTag(note.asset),
    note.sk,
    note.salt,
  ])
  return poseidon.F.toObject(raw)
}

/**
 * Nullifier used to mark a note as spent. Contract stores nullifiers
 * globally; any second attempt to spend the same note is rejected.
 * Derived from `sk` so only the owner can compute it.
 */
export async function computeNullifier(
  sk: bigint,
  index: number
): Promise<bigint> {
  const poseidon = await getPoseidon()
  const raw = poseidon([sk, BigInt(index)])
  return poseidon.F.toObject(raw)
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
  // Field order for BLS12-381 Fr — clamp so the result is < r. Rejection
  // sampling would be cleaner but this bias is negligible for salts.
  const FR_ORDER =
    0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n
  return value % FR_ORDER
}
