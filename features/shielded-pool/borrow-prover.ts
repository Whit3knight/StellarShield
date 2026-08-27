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
  // R17 Phase 3: real user-typed loan amount, raw borrow-asset units —
  // the caller must validate this against `computeBorrowAmount(...)`'s
  // dynamic cap itself; `proveBorrow` no longer auto-derives it.
  amount: bigint
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
 * Maximum raw borrow-asset units the contract's own `dynamic_borrow_cap`
 * will accept for this collateral. Matches its formula exactly
 * (`contracts/borrow-pool/src/lib.rs`: `total_collateral_amount * ratio
 * / 1e14 * max_ltv_bps/10000 * 9500/10000`, including the 95% safety
 * margin) so what the UI validates against matches what the contract
 * will accept — computing it any looser here just means a rejected
 * `borrow_shielded` call after a wasted proving cycle.
 *
 * R17 Phase 3: no longer capped at a flat 90%-of-DENOMINATION ceiling.
 * That cap existed only because repay.circom burns exactly one
 * BORROW-asset deposit note, and deposits used to be fixed-size — so
 * a loan above one denomination could never be repaid. Now that
 * deposits are real, variable user input too (R17 Phase 1), the user
 * can simply deposit however much the repay needs at that time; this
 * function no longer tries to pre-guess that. `amount` is real typed
 * user input (see `use-borrow.ts`) — this is a UI-facing "what's the
 * max I can offer" helper, not something `proveBorrow` calls itself.
 */
export function computeBorrowAmount({
  totalCollateral,
  ratio,
  maxLtvBps,
}: {
  totalCollateral: bigint
  ratio: bigint
  maxLtvBps: number
}): bigint {
  const DYNAMIC_CAP_SAFETY_MARGIN_BPS = 9500n
  return (
    (totalCollateral * ratio * BigInt(maxLtvBps) * DYNAMIC_CAP_SAFETY_MARGIN_BPS) /
    (10_000n * PRICE_RATIO_SCALE * 10_000n)
  )
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

  if (inputs.amount <= 0n) {
    throw new Error(`borrow prover: amount must be > 0, got ${inputs.amount}`)
  }

  // R17 Phase 3: real user-typed amount — the caller (`use-borrow.ts`)
  // is responsible for validating it against `computeBorrowAmount`'s
  // dynamic cap before calling this; this function does not
  // re-derive or silently clamp it (the circuit's own LTV band is
  // decorative, not a solvency guard — see CLAUDE.md — so there is no
  // "safe" amount to compute here anyway; the contract's
  // `dynamic_borrow_cap` is the real, final check at submission time).
  const totalCollateral = inputs.collateralNotes.reduce(
    (acc, note) => acc + note.amount,
    0n
  )
  const collateralValue = totalCollateral * inputs.oraclePrice
  const borrowAmount = inputs.amount

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

// Sanity check — asserts every collateral note comes from the same
// asset, is a real spendable deposit note, and is from the deposit
// tree. R17: amounts vary per note now, so the old hard equality
// against DENOMINATION was doing double duty as an implicit
// positivity check — replaced with an explicit `> 0n` so a
// zero/negative note still fails loudly instead of silently passing
// once the equality constraint was removed.
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
    if (note.amount <= 0n) {
      throw new Error(`collateral note has non-positive amount: ${note.amount}`)
    }
    if (note.tree !== "deposit") {
      throw new Error("collateral must be deposit notes")
    }
  }
}
