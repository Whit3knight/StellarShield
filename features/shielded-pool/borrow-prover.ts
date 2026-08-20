// Generates a shielded-borrow Groth16 proof over N=4 collateral notes.
//
// Circuit at contracts/circuits/shielded-borrow/. Public signals:
//   [0]     borrow_amount
//   [1]     borrow_asset_tag
//   [2]     collateral_asset_tag
//   [3]     hf_min_bps
//   [4]     max_ltv_bps
//   [5]     deposit_root
//   [6]     borrow_commitment
//   [7..11] nullifiers[0..4]
//   [11]    borrow_amount_commit         (Track L bond)
//   [12]    collateral_value_commit      (Track L bond)
//   [13]    borrow_price_commit          (Track L bond)
//   [14]    loan_nullifier               (Track A pre-published)

import {
  assetTag,
  COLLATERAL_NOTES_PER_BORROW,
  computeCommitment,
  computeNullifier,
  DENOMINATION,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { PRICE_RATIO_SCALE } from "@/features/markets/prices"
import { fetchArtefact } from "./artifacts"
import { poseidon } from "@/features/notes/poseidon"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/borrow/borrow.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/borrow/borrow.zkey"

export type BorrowProofInputs = {
  borrowAsset: ShieldedAsset
  borrowSalt: bigint
  collateralAsset: ShieldedAsset
  collateralNotes: ShieldedNote[] // exactly 4
  collateralPaths: bigint[][] // 4 × depth
  collateralBits: number[][] // 4 × depth
  depositRoot: bigint
  hfMinBps: number
  maxLtvBps: number
  /**
   * Cross-asset ratio from `fetchPriceRatio`: one RAW collateral unit
   * priced in RAW borrow units, scaled by 1e14. NOT a USD price — the
   * borrow asset is the denominator, so a same-asset borrow is exactly
   * 1e14.
   */
  oraclePrice: bigint
  sk: bigint
  bondSaltAmount: bigint
  bondSaltValue: bigint
  bondSaltPrice: bigint
}

export type BorrowProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  borrowAmount: bigint
  borrowCommitment: bigint
  nullifiers: bigint[]
  publicSignals: Uint8Array[]
  borrowAmountCommit: bigint
  collateralValueCommit: bigint
  borrowPriceCommit: bigint
  loanNullifier: bigint
}

/**
 * Raw borrow-asset units a borrow will actually mint.
 *
 *   amount = totalCollateral × ratio × maxLtvBps / (10_000 × 1e14)
 *
 * then capped at 90% of one denomination. The cap is load-bearing, not
 * cosmetic: repay.circom burns exactly ONE deposit note and enforces
 * `deposit_amount × index_snapshot >= loan_amount × index_now`, so a
 * loan bigger than one denomination — or one with no headroom for
 * accrued interest — can never be repaid. The borrow circuit only
 * range-checks `borrow_amount` against an LTV band (never an equality),
 * so shrinking the amount keeps the proof valid.
 */
export function computeBorrowAmount({
  totalCollateral,
  ratio,
  maxLtvBps,
  denomination,
}: {
  totalCollateral: bigint
  ratio: bigint
  maxLtvBps: number
  denomination: bigint
}): bigint {
  const fromLtv =
    (totalCollateral * ratio * BigInt(maxLtvBps)) /
    (10_000n * PRICE_RATIO_SCALE)
  const cap = (denomination * 9n) / 10n

  return fromLtv < cap ? fromLtv : cap
}

export async function proveBorrow(
  inputs: BorrowProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<BorrowProofResult> {
  if (inputs.collateralNotes.length !== COLLATERAL_NOTES_PER_BORROW) {
    throw new Error(
      `borrow prover: exactly ${COLLATERAL_NOTES_PER_BORROW} collateral notes required`
    )
  }

  // Aggregate collateral value + derive borrow amount from LTV band.
  const totalCollateral = inputs.collateralNotes.reduce(
    (acc, note) => acc + note.amount,
    0n
  )
  const collateralValue = totalCollateral * inputs.oraclePrice
  const borrowAmount = computeBorrowAmount({
    totalCollateral,
    ratio: inputs.oraclePrice,
    maxLtvBps: inputs.maxLtvBps,
    denomination: DENOMINATION[inputs.borrowAsset],
  })

  const nullifiers = inputs.collateralNotes.map((note) =>
    computeNullifier(inputs.sk, note.index)
  )

  const borrowCommitment = computeCommitment({
    amount: borrowAmount,
    asset: inputs.borrowAsset,
    salt: inputs.borrowSalt,
    sk: inputs.sk,
  })

  const borrowAmountCommit = poseidon([borrowAmount, inputs.bondSaltAmount])
  const collateralValueCommit = poseidon([
    collateralValue,
    inputs.bondSaltValue,
  ])
  const borrowPriceCommit = poseidon([inputs.oraclePrice, inputs.bondSaltPrice])
  const loanNullifier = poseidon([inputs.sk, borrowCommitment])

  const wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL
  const zkeyUrl = options.zkeyUrl ?? DEFAULT_ZKEY_URL

  const [snarkjsModule, wasm, zkey] = await Promise.all([
    // @ts-expect-error — snarkjs ships no TS types.
    import("snarkjs"),
    fetchArtefact(wasmUrl),
    fetchArtefact(zkeyUrl),
  ])
  const snarkjs =
    (snarkjsModule as { default?: unknown }).default ?? snarkjsModule

  const witnessInputs: Record<string, string | string[] | string[][]> = {
    borrow_amount: borrowAmount.toString(),
    borrow_asset_tag: assetTag(inputs.borrowAsset).toString(),
    collateral_asset_tag: assetTag(inputs.collateralAsset).toString(),
    hf_min_bps: inputs.hfMinBps.toString(),
    max_ltv_bps: inputs.maxLtvBps.toString(),
    deposit_root: inputs.depositRoot.toString(),
    borrow_commitment: borrowCommitment.toString(),
    nullifiers: nullifiers.map((value) => value.toString()),
    borrow_amount_commit: borrowAmountCommit.toString(),
    collateral_value_commit: collateralValueCommit.toString(),
    borrow_price_commit: borrowPriceCommit.toString(),
    loan_nullifier: loanNullifier.toString(),

    sk: inputs.sk.toString(),
    borrow_salt: inputs.borrowSalt.toString(),
    collateral_amounts: inputs.collateralNotes.map((note) =>
      note.amount.toString()
    ),
    collateral_salts: inputs.collateralNotes.map((note) =>
      note.salt.toString()
    ),
    collateral_indices: inputs.collateralNotes.map((note) =>
      note.index.toString()
    ),
    collateral_paths: inputs.collateralPaths.map((path) =>
      path.map((element) => element.toString())
    ),
    collateral_bits: inputs.collateralBits.map((bits) =>
      bits.map((bit) => bit.toString())
    ),
    oracle_price: inputs.oraclePrice.toString(),
    bond_salt_amount: inputs.bondSaltAmount.toString(),
    bond_salt_value: inputs.bondSaltValue.toString(),
    bond_salt_price: inputs.bondSaltPrice.toString(),
  }

  const groth16 = (
    snarkjs as {
      groth16: {
        fullProve: (
          input: Record<string, string | string[] | string[][]>,
          wasmFile: Uint8Array | string,
          zkeyFile: Uint8Array | string,
          logger?: unknown,
          wtnsCalcOptions?: unknown,
          proverOptions?: { singleThread?: boolean }
        ) => Promise<{ proof: unknown; publicSignals: string[] }>
      }
    }
  ).groth16

  // In Bun the multithreaded Groth16 prover crashes on Web Worker
  // message dispatch; fall back to single-threaded arithmetic there.
  // Browsers keep the parallel path.
  const singleThread =
    typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
  const { proof, publicSignals } = await groth16.fullProve(
    witnessInputs,
    wasm,
    zkey,
    undefined,
    undefined,
    { singleThread }
  )

  const structured = structureProof(
    proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] }
  )
  const signals = publicSignals.map((decimal) =>
    bigintTo32Bytes(BigInt(decimal))
  )

  return {
    a: structured.a,
    b: structured.b,
    c: structured.c,
    borrowAmount,
    borrowCommitment,
    nullifiers,
    publicSignals: signals,
    borrowAmountCommit,
    collateralValueCommit,
    borrowPriceCommit,
    loanNullifier,
  }
}

// Denomination sanity check — asserts every collateral note comes from
// the same asset and the aggregated amount matches the DENOMINATION
// multiplier the frontend assumes.
export function validateCollateralNotes(
  notes: ShieldedNote[],
  asset: ShieldedAsset
): void {
  if (notes.length !== COLLATERAL_NOTES_PER_BORROW) {
    throw new Error(
      `borrow requires exactly ${COLLATERAL_NOTES_PER_BORROW} collateral notes`
    )
  }
  for (const note of notes) {
    if (note.asset !== asset) {
      throw new Error(
        `collateral asset mismatch: expected ${asset}, saw ${note.asset}`
      )
    }
    if (note.amount !== DENOMINATION[asset]) {
      throw new Error(
        `collateral amount mismatch: expected ${DENOMINATION[asset]}, saw ${note.amount}`
      )
    }
    if (note.tree !== "deposit") {
      throw new Error("collateral must be deposit notes")
    }
  }
}
