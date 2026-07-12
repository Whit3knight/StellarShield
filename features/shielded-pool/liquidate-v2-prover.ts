// Generates a shielded-liquidate-v2 Groth16 proof (Track A).
//
// Circuit at contracts/circuits/shielded-liquidate-v2/. Public
// signals:
//   [0] borrow_amount_commit
//   [1] collateral_value_commit
//   [2] borrow_price_commit
//   [3] current_price
//   [4] threshold_bps
//
// Unlike v1 the circuit doesn't take `sk` — a service worker holding
// only the bond openings can produce a valid proof. Contract wires
// `loan_commitment` and `loan_nullifier` in via tx args and validates
// them against LiquidationBond + LoanNullifier storage.

import { poseidon } from "@/features/notes/poseidon"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/liquidate-v2/liquidate.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/liquidate-v2/liquidate.zkey"

export type LiquidateV2ProofInputs = {
  loanAmount: bigint
  bondSaltAmount: bigint
  collateralNotional: bigint
  bondSaltValue: bigint
  borrowPrice: bigint
  bondSaltPrice: bigint
  currentPrice: bigint
  thresholdBps: number
}

export type LiquidateV2ProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  publicSignals: Uint8Array[]
}

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function proveLiquidateV2(
  inputs: LiquidateV2ProofInputs,
  options: {
    wasmUrl?: string
    zkeyUrl?: string
    wasm?: Uint8Array
    zkey?: Uint8Array
  } = {}
): Promise<LiquidateV2ProofResult> {
  const borrowAmountCommit = poseidon([inputs.loanAmount, inputs.bondSaltAmount])
  const collateralValueCommit = poseidon([
    inputs.collateralNotional,
    inputs.bondSaltValue,
  ])
  const borrowPriceCommit = poseidon([inputs.borrowPrice, inputs.bondSaltPrice])

  const lhs =
    inputs.loanAmount * BigInt(inputs.thresholdBps) * inputs.borrowPrice
  const rhs = inputs.collateralNotional * inputs.currentPrice * 10_000n
  if (lhs <= rhs) {
    throw new Error("liquidate-v2: position is not underwater at current price")
  }

  const wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL
  const zkeyUrl = options.zkeyUrl ?? DEFAULT_ZKEY_URL

  const [snarkjsModule, wasm, zkey] = await Promise.all([
    // @ts-expect-error — snarkjs ships no TS types.
    import("snarkjs"),
    options.wasm ? Promise.resolve(options.wasm) : fetchArtefact(wasmUrl),
    options.zkey ? Promise.resolve(options.zkey) : fetchArtefact(zkeyUrl),
  ])
  const snarkjs =
    (snarkjsModule as { default?: unknown }).default ?? snarkjsModule

  const witnessInputs: Record<string, string> = {
    borrow_amount_commit: borrowAmountCommit.toString(),
    collateral_value_commit: collateralValueCommit.toString(),
    borrow_price_commit: borrowPriceCommit.toString(),
    current_price: inputs.currentPrice.toString(),
    threshold_bps: inputs.thresholdBps.toString(),
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
