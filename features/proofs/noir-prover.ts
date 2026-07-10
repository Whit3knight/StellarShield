import { err, ok } from "@/features/protocol"
import { createStableId } from "@/lib/stable-id"

import type {
  BorrowContractPayload,
  BorrowEligibilityProof,
  BorrowProverAdapter,
  GenerateBorrowProofParams,
} from "./types"

const PROOF_TTL_MS = 10 * 60 * 1000

/**
 * Real Noir + Barretenberg prover. Runs entirely in the browser via
 * dynamic-imported WASM so the heavy prover code lands in an async
 * chunk only when a user actually needs to prove something.
 *
 * Runtime deps (not yet in package.json — add before enabling this
 * adapter):
 *   - `@noir-lang/noir_js`
 *   - `@aztec/bb.js`
 *   - a compiled circuit artifact at
 *     `features/proofs/circuits/borrow-eligibility.compiled.json`
 *     produced by `nargo compile` in
 *     `contracts/circuits/borrow-eligibility`.
 *
 * ponytail: Groth16 vs UltraHonk scheme choice is pinned in Phase 6
 * once the verifier's on-chain cost is measured. Adapter shape stays
 * identical either way — only the `proofBytes` layout differs.
 */

type NoirProverConfig = {
  now?: () => number
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
        const payload = await runNoirCircuit(params, signal)
        if (signal?.aborted) {
          return err({ tag: "Aborted", message: "Proof generation aborted." })
        }

        return ok(buildProofRecord(params, payload, now()))
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
  signal?: AbortSignal
): Promise<BorrowContractPayload> {
  void signal

  // Dynamic imports keep Noir + Barretenberg WASM off the initial
  // chunk. Bundle-check enforces this in scripts/check-bundle.ts.
  // Variable specifiers keep Vite/Rollup from statically resolving these
  // modules at build time. Deps land only when the runtime path is
  // actually taken (NEXT_PUBLIC_STELLAR_SHIELD_PROVER=noir + deps
  // installed). `/* @vite-ignore */` is belt-and-braces for the same
  // reason.
  const noirSpecifier = "@noir-lang/noir_js"
  const bbSpecifier = "@aztec/bb.js"
  const circuitSpecifier = "./circuits/borrow-eligibility.compiled.json"

  const [noirModule, bbModule, circuitModule] = await Promise.all([
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      noirSpecifier
    ),
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      bbSpecifier
    ),
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      circuitSpecifier
    ),
  ])

  const Noir = (noirModule as { Noir: unknown }).Noir
  const UltraHonkBackend = (bbModule as { UltraHonkBackend: unknown })
    .UltraHonkBackend

  const circuit = (circuitModule as { default: unknown }).default
  const noir = new (Noir as unknown as new (c: unknown) => {
    execute: (inputs: Record<string, unknown>) => Promise<{ witness: Uint8Array }>
  })(circuit)

  const backend = new (
    UltraHonkBackend as unknown as new (bytecode: unknown) => {
      generateProof: (
        witness: Uint8Array
      ) => Promise<{ proof: Uint8Array; publicInputs: string[] }>
    }
  )((circuit as { bytecode: unknown }).bytecode)

  const inputs = mapParamsToCircuitInputs(params)
  const { witness } = await noir.execute(inputs)
  const { proof } = await backend.generateProof(witness)

  return {
    oracleEpoch: inputs.oracle_epoch as number,
    oraclePriceCommitment: hexToBytes(
      inputs.oracle_price_commitment as string
    ),
    proofBytes: proof,
  }
}

function mapParamsToCircuitInputs(
  params: GenerateBorrowProofParams
): Record<string, unknown> {
  // ponytail: real mapping happens once nargo compile lands. Includes:
  //   - account hash → account Field
  //   - market Symbol → market Field
  //   - proof_id from createStableId → BytesN<32>
  //   - collateral_amount / borrow_amount → u64
  //   - oracle_price + salt (private) from local wallet-side oracle read
  // Placeholder throws until the real oracle wiring lands so callers
  // fail loud, not silent.
  void params
  throw new Error(
    "mapParamsToCircuitInputs: circuit input mapping not wired yet. " +
      "Add oracle read + poseidon commitment before enabling this adapter."
  )
}

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex
  const padded = stripped.length % 2 === 0 ? stripped : `0${stripped}`
  const out = new Uint8Array(padded.length / 2)
  for (let index = 0; index < out.length; index++) {
    out[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16)
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
