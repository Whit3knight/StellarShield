// Generates a Groth16 proof for the shielded-deposit-quad circuit —
// one proof that binds four commitments to the same amount / asset /
// sk with four fresh salts. Contract accepts this in place of four
// separate `deposit_shielded` calls, so the wallet only signs once
// and the network only pays for one pairing verification.
//
// Circuit at contracts/circuits/shielded-deposit-quad/. Public signals
// (snarkjs order — outputs first, declared publics after):
//   [0..3] commitment[0..3]
//   [4]    amount
//   [5]    asset_tag

import {
  assetTag,
  computeCommitment,
  DENOMINATION,
  type ShieldedAsset,
} from "@/features/notes"
import { fetchArtefact } from "./artifacts"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/deposit_quad/deposit.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/deposit_quad/deposit.zkey"

export type DepositQuadProofInputs = {
  amount: bigint // must equal DENOMINATION[asset]
  asset: ShieldedAsset
  salt: [bigint, bigint, bigint, bigint]
  sk: bigint
}

export type DepositQuadProofResult = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  commitments: [bigint, bigint, bigint, bigint]
  publicSignals: Uint8Array[] // 6 × 32 bytes big-endian Fr
}

export async function proveDepositQuad(
  inputs: DepositQuadProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<DepositQuadProofResult> {
  if (inputs.amount !== DENOMINATION[inputs.asset]) {
    throw new Error(
      `deposit-quad prover: amount ${inputs.amount} must equal denomination ${DENOMINATION[inputs.asset]} for ${inputs.asset}`
    )
  }

  const commitments = inputs.salt.map((s) =>
    computeCommitment({
      amount: inputs.amount,
      asset: inputs.asset,
      salt: s,
      sk: inputs.sk,
    })
  ) as [bigint, bigint, bigint, bigint]

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
    amount: inputs.amount.toString(),
    asset_tag: assetTag(inputs.asset).toString(),
    sk: inputs.sk.toString(),
    salt: inputs.salt.map((s) => s.toString()),
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
    commitments,
    publicSignals: signals,
  }
}
