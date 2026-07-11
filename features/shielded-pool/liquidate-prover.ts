// Generates a shielded-liquidate Groth16 proof.
//
// Circuit at contracts/circuits/shielded-liquidate/. Public signals:
//   [0] loan_commitment
//   [1] borrow_amount_commit
//   [2] collateral_value_commit
//   [3] borrow_price_commit
//   [4] current_price
//   [5] threshold_bps
//   [6] loan_nullifier

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  type ShieldedAsset,
} from "@/features/notes"
import { poseidon } from "@/features/notes/poseidon"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/liquidate/liquidate.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/liquidate/liquidate.zkey"

export type LiquidateProofInputs = {
  loanAsset: ShieldedAsset
  loanAmount: bigint
  loanSalt: bigint
  loanIndex: number
  sk: bigint
  bondSaltAmount: bigint
  bondSaltValue: bigint
  bondSaltPrice: bigint
  collateralNotional: bigint
  borrowPrice: bigint
  currentPrice: bigint
  thresholdBps: number
}

export type LiquidateProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  loanCommitment: bigint
  loanNullifier: bigint
  publicSignals: Uint8Array[]
}

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function proveLiquidate(
  inputs: LiquidateProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<LiquidateProofResult> {
  const loanCommitment = computeCommitment({
    amount: inputs.loanAmount,
    asset: inputs.loanAsset,
    salt: inputs.loanSalt,
    sk: inputs.sk,
  })
  const nullifier = computeNullifier(inputs.sk, inputs.loanIndex)
  const borrowAmountCommit = poseidon([inputs.loanAmount, inputs.bondSaltAmount])
  const collateralValueCommit = poseidon([
    inputs.collateralNotional,
    inputs.bondSaltValue,
  ])
  const borrowPriceCommit = poseidon([inputs.borrowPrice, inputs.bondSaltPrice])

  // Client-side underwater sanity so we never generate a proof the
  // contract will reject.
  const lhs =
    inputs.loanAmount * BigInt(inputs.thresholdBps) * inputs.borrowPrice
  const rhs = inputs.collateralNotional * inputs.currentPrice * 10_000n
  if (lhs <= rhs) {
    throw new Error("liquidate: position is not underwater at current price")
  }

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

  const witnessInputs: Record<string, string> = {
    loan_commitment: loanCommitment.toString(),
    borrow_amount_commit: borrowAmountCommit.toString(),
    collateral_value_commit: collateralValueCommit.toString(),
    borrow_price_commit: borrowPriceCommit.toString(),
    current_price: inputs.currentPrice.toString(),
    threshold_bps: inputs.thresholdBps.toString(),
    loan_nullifier: nullifier.toString(),
    sk: inputs.sk.toString(),
    loan_asset_tag: assetTag(inputs.loanAsset).toString(),
    loan_salt: inputs.loanSalt.toString(),
    loan_index: inputs.loanIndex.toString(),
    loan_amount: inputs.loanAmount.toString(),
    bond_salt_amount: inputs.bondSaltAmount.toString(),
    collateral_notional: inputs.collateralNotional.toString(),
    bond_salt_value: inputs.bondSaltValue.toString(),
    borrow_price: inputs.borrowPrice.toString(),
    bond_salt_price: inputs.bondSaltPrice.toString(),
  }

  const groth16 = (snarkjs as {
    groth16: {
      fullProve: (
        input: Record<string, string>,
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
    loanCommitment,
    loanNullifier: nullifier,
    publicSignals: signals,
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
