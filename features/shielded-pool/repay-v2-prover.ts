// Generates a shielded-repay-v2 (collateral recovery) Groth16 proof.
//
// Circuit at contracts/circuits/shielded-repay-v2/. Public signals:
//   [0]  asset_tag                loan/borrow asset
//   [1]  loan_root
//   [2]  deposit_root             loan asset's deposit tree (repay-source note)
//   [3]  loan_nullifier
//   [4]  deposit_nullifier
//   [5]  borrow_index_snapshot    (Track D)
//   [6]  borrow_index_now         (Track D)
//   [7]  loan_commitment          binds the tx arg to this specific note
//   [8]  collateral_asset_tag
//   [9]  collateral_value_commit  from LiquidationBond
//   [10] borrow_price_commit      from LiquidationBond
//   [11] recovered_commitment     new deposit-tree leaf for the collateral asset
//
// `raw_collateral_amount` isn't looked up from the original 4 spent
// collateral notes — it's exactly `loanNote.bond.collateralValue /
// loanNote.bond.borrowPrice` (plain BigInt division, exact because the
// original multiplication at borrow time was exact integer math). See
// docs/REMEDIATION.md R23.

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  type ShieldedNote,
} from "@/features/notes"
import { fetchArtefact } from "./artifacts"
import { poseidon } from "@/features/notes/poseidon"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/repay-v2/repay.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/repay-v2/repay.zkey"

export type RepayV2ProofInputs = {
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
  newCollateralSalt: bigint
}

export type RepayV2ProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  loanCommitment: bigint
  loanNullifier: bigint
  depositNullifier: bigint
  collateralAmount: bigint
  recoveredCommitment: bigint
  publicSignals: Uint8Array[]
}

export async function proveRepayV2(
  inputs: RepayV2ProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<RepayV2ProofResult> {
  if (inputs.loanNote.asset !== inputs.depositNote.asset) {
    throw new Error("repay-v2: loan and deposit notes must share an asset")
  }
  if (inputs.loanNote.sk !== inputs.depositNote.sk) {
    throw new Error(
      "repay-v2: notes must belong to the same shielded identity"
    )
  }
  const bond = inputs.loanNote.bond
  if (!bond || !bond.collateralAsset) {
    throw new Error(
      "repay-v2: loan note has no Track L bond opening (pre-Track-L loan) — use v1 repay instead"
    )
  }
  const requiredNumerator = inputs.loanNote.amount * inputs.borrowIndexNow
  const providedNumerator =
    inputs.depositNote.amount * inputs.borrowIndexSnapshot
  if (providedNumerator < requiredNumerator) {
    throw new Error(
      `repay-v2: deposit ${inputs.depositNote.amount.toString()} covers ${providedNumerator.toString()} but ${requiredNumerator.toString()} accrued (loan_amount × index_now)`
    )
  }
  if (bond.collateralValue % bond.borrowPrice !== 0n) {
    throw new Error(
      "repay-v2: bond.collateralValue is not an exact multiple of bond.borrowPrice — corrupt or unexpected bond opening"
    )
  }
  const collateralAmount = bond.collateralValue / bond.borrowPrice
  const collateralAsset = bond.collateralAsset

  const loanCommitment = computeCommitment(inputs.loanNote)
  const depositCommitment = computeCommitment(inputs.depositNote)
  const loanNullifier = computeNullifier(
    inputs.loanNote.sk,
    inputs.loanNote.index
  )
  const depositNullifier = computeNullifier(
    inputs.depositNote.sk,
    inputs.depositNote.index
  )
  const recoveredCommitment = computeCommitment({
    amount: collateralAmount,
    asset: collateralAsset,
    sk: inputs.loanNote.sk,
    salt: inputs.newCollateralSalt,
  })
  // Public signals the contract cross-checks against the stored
  // LiquidationBond — Poseidon openings, not the raw values themselves
  // (those are the private witnesses below).
  const collateralValueCommit = poseidon([bond.collateralValue, bond.saltValue])
  const borrowPriceCommit = poseidon([bond.borrowPrice, bond.saltPrice])

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
    loan_commitment: loanCommitment.toString(),
    collateral_asset_tag: assetTag(collateralAsset).toString(),
    collateral_value_commit: collateralValueCommit.toString(),
    borrow_price_commit: borrowPriceCommit.toString(),
    recovered_commitment: recoveredCommitment.toString(),
    sk: inputs.loanNote.sk.toString(),
    loan_amount: inputs.loanNote.amount.toString(),
    loan_salt: inputs.loanNote.salt.toString(),
    loan_index: inputs.loanNote.index.toString(),
    loan_path_elements: inputs.loanPathElements.map((v) => v.toString()),
    loan_path_bits: inputs.loanPathBits.map((b) => b.toString()),
    deposit_amount: inputs.depositNote.amount.toString(),
    deposit_salt: inputs.depositNote.salt.toString(),
    deposit_index: inputs.depositNote.index.toString(),
    deposit_path_elements: inputs.depositPathElements.map((v) =>
      v.toString()
    ),
    deposit_path_bits: inputs.depositPathBits.map((b) => b.toString()),
    raw_collateral_amount: collateralAmount.toString(),
    bond_salt_value: bond.saltValue.toString(),
    collateral_oracle_price: bond.borrowPrice.toString(),
    bond_salt_price: bond.saltPrice.toString(),
    new_collateral_salt: inputs.newCollateralSalt.toString(),
  }

  const groth16 = (
    snarkjs as {
      groth16: {
        fullProve: (
          input: Record<string, string | string[]>,
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
  // message dispatch — same issue borrow-prover.ts/liquidate-prover.ts
  // already work around (see docs/REMEDIATION.md R22).
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

  void depositCommitment
  return {
    a: structured.a,
    b: structured.b,
    c: structured.c,
    loanCommitment,
    loanNullifier,
    depositNullifier,
    collateralAmount,
    recoveredCommitment,
    publicSignals: signals,
  }
}
