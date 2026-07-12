// Generates a shielded-deposit Groth16 proof. Same pattern as
// features/proofs/snarkjs-prover.ts but scoped to the deposit
// circuit — the borrow / repay / withdraw / liquidate provers follow
// this shape once their circuits land.
//
// Circuit at contracts/circuits/shielded-deposit/. Public signals:
//   [0] amount        (fixed denomination in whole units)
//   [1] asset_tag     (0 = XLM, 1 = USDC, 2 = EURC)
//   [2] commitment    (Poseidon output — new deposit tree leaf)

import {
  assetTag,
  computeCommitment,
  DENOMINATION,
  type ShieldedAsset,
} from "@/features/notes"
import { bigintTo32Bytes, structureProof } from "./proof-encoding"

const DEFAULT_WASM_URL = "/circuits-circom/shielded/deposit/deposit.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/shielded/deposit/deposit.zkey"

export type DepositProofInputs = {
  amount: bigint // must equal DENOMINATION[asset]
  asset: ShieldedAsset
  salt: bigint
  sk: bigint
}

export type DepositProofResult = {
  a: Uint8Array // 96 bytes, G1 uncompressed
  b: Uint8Array // 192 bytes, G2 uncompressed
  c: Uint8Array // 96 bytes, G1 uncompressed
  commitment: bigint
  publicSignals: Uint8Array[] // 3 × 32 bytes big-endian Fr
}

async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Generate a Groth16 proof for a new shielded-deposit note. The
 * returned commitment matches what `features/notes/computeCommitment`
 * would produce for the same inputs; the caller ships that value +
 * proof to `borrow_pool.deposit_shielded`.
 */
export async function proveDeposit(
  inputs: DepositProofInputs,
  options: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<DepositProofResult> {
  if (inputs.amount !== DENOMINATION[inputs.asset]) {
    throw new Error(
      `deposit prover: amount ${inputs.amount} must equal denomination ${DENOMINATION[inputs.asset]} for ${inputs.asset}`
    )
  }

  const commitment = computeCommitment({
    amount: inputs.amount,
    asset: inputs.asset,
    salt: inputs.salt,
    sk: inputs.sk,
  })

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
    amount: inputs.amount.toString(),
    asset_tag: assetTag(inputs.asset).toString(),
    salt: inputs.salt.toString(),
    sk: inputs.sk.toString(),
  }

  const groth16 = (snarkjs as {
    groth16: {
      fullProve: (
        input: Record<string, string>,
        wasmFile: Uint8Array | string,
        zkeyFile: Uint8Array | string,
        logger?: unknown,
        wtnsCalcOptions?: unknown,
        proverOptions?: { singleThread?: boolean }
      ) => Promise<{ proof: unknown; publicSignals: string[] }>
    }
  }).groth16

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
  const signals = publicSignals.map((decimal) => bigintTo32Bytes(BigInt(decimal)))

  return {
    a: structured.a,
    b: structured.b,
    c: structured.c,
    commitment,
    publicSignals: signals,
  }
}

