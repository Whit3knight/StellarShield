// Generates a shielded-repay Groth16 proof.
//
// Circuit at contracts/circuits/shielded-repay/. Public signals:
//   [0] asset_tag
//   [1] loan_root
//   [2] deposit_root
//   [3] loan_nullifier
//   [4] deposit_nullifier
//   [5] borrow_index_snapshot  (Track D)
//   [6] borrow_index_now       (Track D)

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  type ShieldedNote,
} from "@/features/notes"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/repay/repay.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/repay/repay.zkey"

export type RepayProofInputs = {
  loanNote: ShieldedNote
  loanRoot: bigint
  loanPathBits: number[]
  loanPathElements: bigint[]
  depositNote: ShieldedNote
  depositRoot: bigint
  depositPathBits: number[]
  depositPathElements: bigint[]
  borrowIndexSnapshot: bigint
  borrowIndexNow: bigint
}

export type RepayProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  loanNullifier: bigint
  depositNullifier: bigint
  publicSignals: Uint8Array[]
}

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function proveRepay(
  inputs: RepayProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<RepayProofResult> {
  if (inputs.loanNote.asset !== inputs.depositNote.asset) {
    throw new Error("repay: loan and deposit notes must share an asset")
  }
  if (inputs.loanNote.sk !== inputs.depositNote.sk) {
    throw new Error("repay: notes must belong to the same shielded identity")
  }
  const requiredNumerator =
    inputs.loanNote.amount * inputs.borrowIndexNow
  const providedNumerator =
    inputs.depositNote.amount * inputs.borrowIndexSnapshot
  if (providedNumerator < requiredNumerator) {
    throw new Error(
      `repay: deposit ${inputs.depositNote.amount.toString()} covers ${providedNumerator.toString()} but ${requiredNumerator.toString()} accrued (loan_amount × index_now)`
    )
  }

  const loanCommitment = computeCommitment(inputs.loanNote)
  const depositCommitment = computeCommitment(inputs.depositNote)
  const loanNullifier = computeNullifier(inputs.loanNote.sk, inputs.loanNote.index)
  const depositNullifier = computeNullifier(
    inputs.depositNote.sk,
    inputs.depositNote.index
  )

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
    asset_tag: assetTag(inputs.loanNote.asset).toString(),
    loan_root: inputs.loanRoot.toString(),
    deposit_root: inputs.depositRoot.toString(),
    loan_nullifier: loanNullifier.toString(),
    deposit_nullifier: depositNullifier.toString(),
    borrow_index_snapshot: inputs.borrowIndexSnapshot.toString(),
    borrow_index_now: inputs.borrowIndexNow.toString(),
    sk: inputs.loanNote.sk.toString(),
    loan_amount: inputs.loanNote.amount.toString(),
    loan_salt: inputs.loanNote.salt.toString(),
    loan_index: inputs.loanNote.index.toString(),
    loan_path_elements: inputs.loanPathElements.map((v) => v.toString()),
    loan_path_bits: inputs.loanPathBits.map((b) => b.toString()),
    deposit_amount: inputs.depositNote.amount.toString(),
    deposit_salt: inputs.depositNote.salt.toString(),
    deposit_index: inputs.depositNote.index.toString(),
    deposit_path_elements: inputs.depositPathElements.map((v) => v.toString()),
    deposit_path_bits: inputs.depositPathBits.map((b) => b.toString()),
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

  const { proof, publicSignals } = await groth16.fullProve(witnessInputs, wasm, zkey)

  const structured = structureProof(
    proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] }
  )
  const signals = publicSignals.map((decimal) => bigintTo32Bytes(BigInt(decimal)))

  void loanCommitment
  void depositCommitment
  return {
    a: structured.a,
    b: structured.b,
    c: structured.c,
    loanNullifier,
    depositNullifier,
    publicSignals: signals,
  }
}

