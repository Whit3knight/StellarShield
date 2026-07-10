import { err, ok } from "@/features/protocol"
import { createStableId } from "@/lib/stable-id"

import type {
  BorrowContractPayload,
  BorrowEligibilityProof,
  BorrowProverAdapter,
  GenerateBorrowProofParams,
} from "./types"

const PROOF_TTL_MS = 10 * 60 * 1000

// Circuit constants — must match contracts/circuits/borrow-eligibility/src/main.nr.
const HEALTH_FACTOR_BPS_SCALE = 10_000
const LTV_BPS_SCALE = 10_000
// Stellar amounts are stored with 7 fractional digits ("stroops" for XLM).
const AMOUNT_FIXED_POINT_SCALE = 10_000_000

/**
 * Real Noir + Barretenberg prover. Runs entirely in the browser via
 * dynamic-imported WASM so the heavy prover code lands in an async
 * chunk only when a user actually needs to prove something.
 *
 * Runtime deps:
 *   - `@noir-lang/noir_js`
 *   - `@aztec/bb.js`
 *   - compiled circuit artifact at
 *     `features/proofs/circuits/borrow-eligibility.compiled.json`
 *     produced by `nargo compile`.
 *
 * ponytail: skeleton uses UltraHonk (Barretenberg default). Swap to
 * Groth16 later if the on-chain verifier gas profile calls for it.
 * Adapter shape stays identical — only `proofBytes` layout differs.
 */

type NoirProverConfig = {
  now?: () => number
}

export type CircuitInputs = {
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

export function createNoirBorrowProverAdapter(
  config: NoirProverConfig = {}
): BorrowProverAdapter {
  const now = config.now ?? (() => Date.now())

  return {
    generateBorrowProof: async (params, signal) => {
      if (signal?.aborted) {
        return err({ tag: "Aborted", message: "Proof generation aborted." })
      }

      try {
        const nowMs = now()
        const payload = await runNoirCircuit(params, nowMs, signal)
        if (signal?.aborted) {
          return err({ tag: "Aborted", message: "Proof generation aborted." })
        }

        return ok(buildProofRecord(params, payload, nowMs))
      } catch (cause) {
        if (signal?.aborted) {
          return err({ tag: "Aborted", message: "Proof generation aborted." })
        }

        const message =
          cause instanceof Error ? cause.message : "Noir prover failed."
        return err({ tag: "Unknown", message })
      }
    },
  }
}

async function runNoirCircuit(
  params: GenerateBorrowProofParams,
  nowMs: number,
  signal?: AbortSignal
): Promise<BorrowContractPayload> {
  void signal

  // Dynamic imports keep Noir + Barretenberg WASM off the initial chunk;
  // Turbopack/webpack chunk them async automatically.
  const [noirModule, bbModule, circuitModule] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
    import("./circuits/borrow-eligibility.compiled.json"),
  ])

  const Noir = (noirModule as { Noir: unknown }).Noir
  const UltraHonkBackend = (bbModule as { UltraHonkBackend: unknown })
    .UltraHonkBackend

  const circuit = (circuitModule as { default: unknown }).default
  const noir = new (Noir as unknown as new (c: unknown) => {
    execute: (
      inputs: Record<string, unknown>
    ) => Promise<{ witness: Uint8Array; returnValue: string | string[] }>
  })(circuit)

  const backend = new (
    UltraHonkBackend as unknown as new (bytecode: unknown) => {
      generateProof: (
        witness: Uint8Array
      ) => Promise<{ proof: Uint8Array; publicInputs: string[] }>
    }
  )((circuit as { bytecode: unknown }).bytecode)

  const oracleEpoch = mockOracleEpoch(nowMs)
  const inputs = mapParamsToCircuitInputs(params, oracleEpoch)

  const { witness, returnValue } = await noir.execute(inputs)
  const { proof } = await backend.generateProof(witness)

  const commitmentHex = Array.isArray(returnValue)
    ? returnValue[0]
    : returnValue

  return {
    oracleEpoch,
    oraclePriceCommitment: hexToBytes32(commitmentHex),
    proofBytes: proof,
  }
}

/**
 * Deterministic mock oracle. Real integration reads a signed price
 * from Reflector (or a permissioned oracle contract) and passes the
 * epoch + salt through the same commitment shape.
 *
 * ponytail: swap for Reflector cross-contract read once the oracle
 * source is picked. Skeleton returns price 1.0000000 (fixed-point)
 * and a salt derived from the market + epoch so the same intent
 * hashes stably within a ~5s window.
 */
export function mockOracle(marketSymbol: string, nowMs: number): {
  epoch: number
  price: bigint
  salt: string
} {
  const epoch = Math.floor(nowMs / 1000)
  const salt = fieldFromString(`${marketSymbol}:${epoch}`)
  return {
    epoch,
    price: BigInt(1 * AMOUNT_FIXED_POINT_SCALE),
    salt,
  }
}

function mockOracleEpoch(nowMs: number): number {
  return Math.floor(nowMs / 1000)
}

export function mapParamsToCircuitInputs(
  params: GenerateBorrowProofParams,
  oracleEpoch: number
): CircuitInputs {
  const oracle = mockOracle(params.market, oracleEpoch * 1000)

  const collateralAmount = toFixedPointBigInt(params.collateral.amount)
  const borrowAmount = toFixedPointBigInt(params.borrow.amount)

  return {
    account: fieldFromString(params.account ?? "disconnected"),
    market: fieldFromString(params.market),
    proof_id: fieldFromString(
      createStableId(
        "proof",
        params.account ?? "disconnected",
        params.market,
        params.borrow.symbol,
        params.borrow.amount,
        params.collateral.symbol,
        params.collateral.amount
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
    oracle_price: oracle.price.toString(),
    oracle_price_salt: oracle.salt,
    // Skeleton: assume prover holds exactly the claimed collateral. Real
    // integration reads the on-account balance and asserts it here.
    raw_collateral_balance: collateralAmount.toString(),
  }
}

function toFixedPointBigInt(amount: number): bigint {
  return BigInt(Math.round(amount * AMOUNT_FIXED_POINT_SCALE))
}

/**
 * Fold an arbitrary string into a BLS12-381 Fr-safe hex value. Not a
 * hash — a light domain-separating fold that keeps the value under
 * ~248 bits so it fits every field element without wrapping.
 *
 * ponytail: swap for a real hash (SHA-256 truncated, or poseidon once
 * available) before audit. Skeleton stability, not soundness.
 */
export function fieldFromString(value: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  const digest = new Uint8Array(31)
  for (let index = 0; index < bytes.length; index++) {
    digest[index % 31] ^= bytes[index]
  }
  return `0x${bytesToHex(digest)}`
}

function hexToBytes32(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex
  const padded = stripped.padStart(64, "0")
  const out = new Uint8Array(32)
  for (let index = 0; index < 32; index++) {
    out[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0")
  }
  return out
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
