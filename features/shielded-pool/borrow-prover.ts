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
  computeCommitment,
  computeNullifier,
  DENOMINATION,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { poseidon } from "@/features/notes/poseidon"

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
  oraclePrice: bigint // whole-unit price of collateral in borrow-asset units
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

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function proveBorrow(
  inputs: BorrowProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<BorrowProofResult> {
  if (inputs.collateralNotes.length !== 4) {
    throw new Error("borrow prover: exactly 4 collateral notes required")
  }

  // Aggregate collateral value + derive borrow amount from LTV band.
  const totalCollateral = inputs.collateralNotes.reduce(
    (acc, note) => acc + note.amount,
    0n
  )
  const collateralValue = totalCollateral * inputs.oraclePrice
  const borrowAmount =
    (collateralValue * BigInt(inputs.maxLtvBps)) / 10_000n

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
  const collateralValueCommit = poseidon([collateralValue, inputs.bondSaltValue])
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
    collateral_salts: inputs.collateralNotes.map((note) => note.salt.toString()),
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

  const groth16 = (snarkjs as {
    groth16: {
      fullProve: (
        input: Record<string, string | string[] | string[][]>,
        wasmFile: Uint8Array | string,
        zkeyFile: Uint8Array | string
      ) => Promise<{ proof: unknown; publicSignals: string[] }>
    }
  }).groth16

  const { proof, publicSignals } = await groth16.fullProve(
    witnessInputs,
    wasm,
    zkey
  )

  const structured = structureProof(
    proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] }
  )
  const signals = publicSignals.map((decimal) => bigintTo32Bytes(BigInt(decimal)))

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
  if (notes.length !== 4) {
    throw new Error("borrow requires exactly 4 collateral notes")
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

const FP_BYTES = 48
const INFINITY_BYTE = 0x40

function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let residue = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(residue & 0xffn)
    residue >>= 8n
  }
  return out
}

function encodeFp(decimal: string): Uint8Array {
  let value = BigInt(decimal)
  const out = new Uint8Array(FP_BYTES)
  for (let index = FP_BYTES - 1; index >= 0; index--) {
    out[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return out
}

function encodeG1(pi: string[]): Uint8Array {
  const [x, y, z] = pi
  const out = new Uint8Array(FP_BYTES * 2)
  if (z === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  out.set(encodeFp(x), 0)
  out.set(encodeFp(y), FP_BYTES)
  return out
}

function encodeG2(pi: string[][]): Uint8Array {
  const [[xC0, xC1], [yC0, yC1], zPair] = pi
  const out = new Uint8Array(FP_BYTES * 4)
  if (zPair[0] === "0" && zPair[1] === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  out.set(encodeFp(xC0), 0)
  out.set(encodeFp(xC1), FP_BYTES)
  out.set(encodeFp(yC0), FP_BYTES * 2)
  out.set(encodeFp(yC1), FP_BYTES * 3)
  return out
}

function structureProof(proof: {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
}): { a: Uint8Array; b: Uint8Array; c: Uint8Array } {
  return {
    a: encodeG1(proof.pi_a),
    b: encodeG2(proof.pi_b),
    c: encodeG1(proof.pi_c),
  }
}
