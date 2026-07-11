// Generates a shielded-withdraw Groth16 proof.
//
// Circuit at contracts/circuits/shielded-withdraw/. Public signals:
//   [0] asset_tag
//   [1] denomination
//   [2] deposit_root
//   [3] nullifier

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  DENOMINATION,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/withdraw/withdraw.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/withdraw/withdraw.zkey"

export type WithdrawProofInputs = {
  depositRoot: bigint
  note: ShieldedNote
  pathBits: number[] // length matches merkle depth (20)
  pathElements: bigint[]
}

export type WithdrawProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  commitment: bigint
  nullifier: bigint
  publicSignals: Uint8Array[] // 4 × 32 bytes big-endian Fr
}

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function proveWithdraw(
  inputs: WithdrawProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<WithdrawProofResult> {
  const commitment = computeCommitment(inputs.note)
  const nullifier = computeNullifier(inputs.note.sk, inputs.note.index)

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

  const witnessInputs: Record<string, string | string[]> = {
    asset_tag: assetTag(inputs.note.asset).toString(),
    denomination: DENOMINATION[inputs.note.asset as ShieldedAsset].toString(),
    deposit_root: inputs.depositRoot.toString(),
    nullifier: nullifier.toString(),
    sk: inputs.note.sk.toString(),
    salt: inputs.note.salt.toString(),
    leaf_index: inputs.note.index.toString(),
    path_elements: inputs.pathElements.map((value) => value.toString()),
    path_bits: inputs.pathBits.map((bit) => bit.toString()),
  }

  const groth16 = (snarkjs as {
    groth16: {
      fullProve: (
        input: Record<string, string | string[]>,
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
    commitment,
    nullifier,
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
