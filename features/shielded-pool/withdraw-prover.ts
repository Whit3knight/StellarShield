// Generates a shielded-withdraw Groth16 proof.
//
// Circuit at contracts/circuits/shielded-withdraw/. Public signals:
//   [0] asset_tag
//   [1] amount (fixed denomination for deposit notes, variable for loan notes)
//   [2] tree root (deposit_root or loan_root)
//   [3] nullifier

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  type ShieldedNote,
} from "@/features/notes"
import { fetchArtefact } from "./artifacts"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

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
    denomination: inputs.note.amount.toString(),
    deposit_root: inputs.depositRoot.toString(),
    nullifier: nullifier.toString(),
    sk: inputs.note.sk.toString(),
    salt: inputs.note.salt.toString(),
    leaf_index: inputs.note.index.toString(),
    path_elements: inputs.pathElements.map((value) => value.toString()),
    path_bits: inputs.pathBits.map((bit) => bit.toString()),
  }

  const groth16 = (
    snarkjs as {
      groth16: {
        fullProve: (
          input: Record<string, string | string[]>,
          wasmFile: Uint8Array | string,
          zkeyFile: Uint8Array | string
        ) => Promise<{ proof: unknown; publicSignals: string[] }>
      }
    }
  ).groth16

  const { proof, publicSignals } = await groth16.fullProve(
    witnessInputs,
    wasm,
    zkey
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
    commitment,
    nullifier,
    publicSignals: signals,
  }
}
