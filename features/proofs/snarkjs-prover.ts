import { err, ok } from "@/features/protocol"
import { createStableId } from "@/lib/stable-id"

import { ensureSnarkjsArtefacts } from "./preload"
import type {
  BorrowContractPayload,
  BorrowEligibilityProof,
  BorrowProverAdapter,
  GenerateBorrowProofParams,
} from "./types"

const PROOF_TTL_MS = 10 * 60 * 1000

// Circuit constants — must match
// contracts/circuits/borrow-eligibility-circom/src/borrow_eligibility.circom.
const HEALTH_FACTOR_BPS_SCALE = 10_000
const LTV_BPS_SCALE = 10_000

/**
 * Circom + snarkjs Groth16 prover over BN254. Replaces the Noir/BB
 * pipeline which hit an upstream WASM bug in bb 5.0.0-nightly
 * UltraHonk. Groth16 proofs are 192 bytes and pair with the
 * Nethermind/SDF Soroban verifier for cheap on-chain verify.
 *
 * Runtime deps:
 *   - `snarkjs` (installed at repo root)
 *   - compiled circuit artefacts at
 *     `features/proofs/circuits-circom/borrow_eligibility.wasm`
 *     `features/proofs/circuits-circom/borrow_eligibility.zkey`
 *     produced by:
 *       cd contracts/circuits/borrow-eligibility-circom
 *       circom src/borrow_eligibility.circom --r1cs --wasm -l node_modules -o build
 *       snarkjs groth16 setup build/borrow_eligibility.r1cs <ptau> build/borrow_eligibility.zkey
 *
 * See contracts/circuits/borrow-eligibility-circom/README.md for the
 * full compile pipeline.
 */

type SnarkjsProverConfig = {
  now?: () => number
  wasmUrl?: string
  zkeyUrl?: string
}

const DEFAULT_WASM_URL = "/circuits-circom/borrow_eligibility.wasm"
const DEFAULT_ZKEY_URL = "/circuits-circom/borrow_eligibility.zkey"

export type Groth16CircuitInputs = {
  account: string
  market: string
  proof_id: string
  collateral_symbol: string
  borrow_symbol: string
  collateral_amount: string
  borrow_amount: string
  hf_min_bps: string
  max_ltv_bps: string
  oracle_epoch: string
  oracle_price: string
  oracle_price_salt: string
  raw_collateral_balance: string
}

export function createSnarkjsBorrowProverAdapter(
  config: SnarkjsProverConfig = {}
): BorrowProverAdapter {
  const now = config.now ?? (() => Date.now())
  const wasmUrl = config.wasmUrl ?? DEFAULT_WASM_URL
  const zkeyUrl = config.zkeyUrl ?? DEFAULT_ZKEY_URL

  return {
    generateBorrowProof: async (params, signal) => {
      if (signal?.aborted) {
        return err({ tag: "Aborted", message: "Proof generation aborted." })
      }

      try {
        const nowMs = now()
        const payload = await runCircomCircuit(
          params,
          nowMs,
          { wasmUrl, zkeyUrl },
          signal
        )
        if (signal?.aborted) {
          return err({ tag: "Aborted", message: "Proof generation aborted." })
        }

        return ok(buildProofRecord(params, payload, nowMs))
      } catch (cause) {
        if (signal?.aborted) {
          return err({ tag: "Aborted", message: "Proof generation aborted." })
        }

        console.error("snarkjs prover failure", cause)
        const name =
          cause instanceof Error && cause.name ? `${cause.name}: ` : ""
        const message =
          cause instanceof Error && cause.message
            ? `${name}${cause.message}`
            : `snarkjs prover failed: ${String(cause)}`
        return err({ tag: "Unknown", message })
      }
    },
  }
}

async function runCircomCircuit(
  params: GenerateBorrowProofParams,
  nowMs: number,
  urls: { wasmUrl: string; zkeyUrl: string },
  signal?: AbortSignal
): Promise<BorrowContractPayload> {
  void signal

  // Kick artefact fetch + module import in parallel. preloadProver()
  // at wallet-connect usually beats us here — this second call reuses
  // the module-level cache.
  const [snarkjsModule, artefacts] = await Promise.all([
    // @ts-expect-error — snarkjs ships no TS types.
    import("snarkjs"),
    ensureSnarkjsArtefacts({ wasmUrl: urls.wasmUrl, zkeyUrl: urls.zkeyUrl }),
  ])
  const snarkjs =
    (snarkjsModule as { default?: unknown }).default ?? snarkjsModule

  const oracleEpoch = Math.floor(nowMs / 1000)
  const inputs = mapParamsToCircuitInputs(params, oracleEpoch)

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
    inputs,
    artefacts.wasm,
    artefacts.zkey
  )

  // snarkjs returns public output at the end of publicSignals (circom
  // pragma places outputs after inputs).
  const commitmentDecimal = publicSignals[publicSignals.length - 1]
  const commitment = bigintToBytes32(BigInt(commitmentDecimal))
  const structured = structuredGroth16Proof(
    proof as {
      pi_a: string[]
      pi_b: string[][]
      pi_c: string[]
    }
  )
  const encodedSignals = publicSignals.map((decimal) =>
    bigintToBytes32(BigInt(decimal))
  )

  return {
    a: structured.a,
    b: structured.b,
    c: structured.c,
    oracleEpoch,
    oraclePriceCommitment: commitment,
    publicSignals: encodedSignals,
  }
}

export function mapParamsToCircuitInputs(
  params: GenerateBorrowProofParams,
  oracleEpoch: number
): Groth16CircuitInputs {
  const salt = fieldFromString(`${params.market}:${oracleEpoch}`)
  const price = "1"
  const collateralAmount = Math.max(1, Math.floor(params.collateral.amount))
  const borrowAmount = Math.max(1, Math.floor(params.borrow.amount))

  return {
    account: fieldFromString(params.account ?? "disconnected"),
    market: fieldFromString(params.market),
    proof_id: fieldFromString(
      // Include oracleEpoch so each proof-gen yields a fresh proofId
      // — contract's persistent proofUsed guard would otherwise reject
      // any retry with identical amounts as `ProofReplayed`.
      createStableId(
        "proof",
        params.account ?? "disconnected",
        params.market,
        params.borrow.symbol,
        params.borrow.amount,
        params.collateral.symbol,
        params.collateral.amount,
        oracleEpoch
      )
    ),
    collateral_symbol: fieldFromString(params.collateral.symbol),
    borrow_symbol: fieldFromString(params.borrow.symbol),
    collateral_amount: collateralAmount.toString(),
    borrow_amount: borrowAmount.toString(),
    hf_min_bps: Math.round(
      params.healthFactorMin * HEALTH_FACTOR_BPS_SCALE
    ).toString(),
    max_ltv_bps: Math.round(params.maxLtv * LTV_BPS_SCALE).toString(),
    oracle_epoch: oracleEpoch.toString(),
    oracle_price: price,
    oracle_price_salt: salt,
    raw_collateral_balance: collateralAmount.toString(),
  }
}

/**
 * Fold an arbitrary string into a BN254 Fr-safe decimal value. Not a
 * hash — a light domain-separating fold that keeps the value under
 * ~248 bits so it fits every field element without wrapping. Circom
 * fields are decimal-string in the JSON input format.
 */
export function fieldFromString(value: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  let acc = 0n
  for (const byte of bytes) {
    // Rolling multiply-add with a small prime keeps the value
    // in-range and cheap to compute.
    acc = (acc * 131n + BigInt(byte)) & ((1n << 248n) - 1n)
  }
  return acc.toString()
}

function bigintToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let v = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

/**
 * Structured Groth16 proof (BLS12-381, uncompressed):
 *   a: G1 = 96 bytes  (be_bytes(X) || be_bytes(Y))
 *   b: G2 = 192 bytes (be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0))
 *   c: G1 = 96 bytes
 * Byte layout matches soroban-sdk's G1Affine/G2Affine `from_array` doc:
 * G1 is x||y big-endian, G2 is c1-first (Fp2 element = c1 || c0). snarkjs
 * emits pi_b as [[x_c0, x_c1], [y_c0, y_c1]] so we swap when packing.
 */
function structuredGroth16Proof(proof: {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
}): { a: Uint8Array; b: Uint8Array; c: Uint8Array } {
  const a = new Uint8Array(96)
  writeFp(a, 0, proof.pi_a[0])
  writeFp(a, 48, proof.pi_a[1])

  const b = new Uint8Array(192)
  // Soroban G2 order: X_c1 || X_c0 || Y_c1 || Y_c0
  writeFp(b, 0, proof.pi_b[0][1])
  writeFp(b, 48, proof.pi_b[0][0])
  writeFp(b, 96, proof.pi_b[1][1])
  writeFp(b, 144, proof.pi_b[1][0])

  const c = new Uint8Array(96)
  writeFp(c, 0, proof.pi_c[0])
  writeFp(c, 48, proof.pi_c[1])

  return { a, b, c }
}

function writeFp(target: Uint8Array, offset: number, decimal: string): void {
  let value = BigInt(decimal)
  for (let index = 47; index >= 0; index--) {
    target[offset + index] = Number(value & 0xffn)
    value >>= 8n
  }
}

function buildProofRecord(
  params: GenerateBorrowProofParams,
  payload: BorrowContractPayload,
  nowMs: number
): BorrowEligibilityProof {
  return {
    claim: params.isEligible
      ? "Borrow eligibility verified"
      : "Borrow eligibility failed",
    contractPayload: payload,
    expiresAt: new Date(nowMs + PROOF_TTL_MS).toISOString(),
    id: createStableId(
      "proof",
      params.account ?? "disconnected",
      params.market,
      params.borrow.symbol,
      params.borrow.amount,
      params.collateral.symbol,
      params.collateral.amount,
      payload.oracleEpoch,
      params.isEligible ? "eligible" : "failed"
    ),
    publicInputs: {
      healthFactorMin: params.healthFactorMin.toFixed(2),
      market: params.market,
      maxLtv: `${Math.round(params.maxLtv * 100)}%`,
    },
    status: params.isEligible ? "Verified" : "Failed",
  }
}
