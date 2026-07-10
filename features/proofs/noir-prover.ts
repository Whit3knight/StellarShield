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
// Circuit works in whole asset units (integer XLM / USDC), not stroops.
// bb.js 5.0.0-nightly UltraHonk doesn't yet handle u128 opcodes so we
// keep the circuit in u64 with reduced scale. Restore stroop precision
// once upstream ships u128 support.
const WHOLE_UNIT_SCALE = 1

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

        // Preserve the concrete failure so the UI can render it and
        // console.error keeps the full stack for devtools.
        // eslint-disable-next-line no-console
        console.error("noir prover failure", cause)
        const name =
          cause instanceof Error && cause.name ? `${cause.name}: ` : ""
        const message =
          cause instanceof Error && cause.message
            ? `${name}${cause.message}`
            : `Noir prover failed: ${String(cause)}`
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
  const Barretenberg = (bbModule as { Barretenberg: unknown }).Barretenberg

  const circuit = (circuitModule as { default: unknown }).default
  const noir = new (Noir as unknown as new (c: unknown) => {
    execute: (
      inputs: Record<string, unknown>
    ) => Promise<{ witness: Uint8Array; returnValue: string | string[] }>
  })(circuit)

  // UltraHonkBackend needs a live Barretenberg WASM handle. Singleton
  // reuses the same instance across calls so the first proof pays the
  // init cost and subsequent proofs are fast. Pin threads to 1 —
  // multi-threaded WASM under COOP/COEP has been flaky and triggers
  // `RuntimeError: unreachable` inside bb's builder in this build.
  const api = await (
    Barretenberg as unknown as {
      initSingleton: (opts?: Record<string, unknown>) => Promise<unknown>
    }
  ).initSingleton({ threads: 1 })

  const backend = new (
    UltraHonkBackend as unknown as new (
      bytecode: unknown,
      api: unknown
    ) => {
      generateProof: (
        witness: Uint8Array
      ) => Promise<{ proof: Uint8Array; publicInputs: string[] }>
    }
  )((circuit as { bytecode: unknown }).bytecode, api)

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
    // Whole-number exchange rate (matches circuit's u64 scale).
    price: 1n,
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

  const collateralAmount = toWholeUnitBigInt(params.collateral.amount)
  const borrowAmount = toWholeUnitBigInt(params.borrow.amount)

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

function toWholeUnitBigInt(amount: number): bigint {
  const whole = Math.max(1, Math.floor(amount * WHOLE_UNIT_SCALE))
  return BigInt(whole)
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
