import type { AdapterResult } from "@/features/protocol"
import type { AssetAmount } from "@/features/shared/asset-amount"

export type BorrowProofStatus = "Failed" | "Verified"

export type BorrowProofPublicInputs = {
  healthFactorMin: string
  market: string
  maxLtv: string
}

/**
 * Structured Groth16 proof over BLS12-381 (uncompressed) plus the
 * on-chain oracle bindings required by the borrow-pool contract.
 *   a: 96 bytes  (G1: 48-byte big-endian x || y)
 *   b: 192 bytes (G2: Fp2 x || Fp2 y = 48 * 4)
 *   c: 96 bytes  (G1)
 *   publicSignals: 11 x u256 (BLS12-381 Fr elements, big-endian 32 bytes).
 * Attached by the snarkjs prover; the mock/legacy adapters leave it
 * `undefined`.
 */
export type BorrowContractPayload = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
  oracleEpoch: number
  oraclePriceCommitment: Uint8Array
  publicSignals: Uint8Array[]
}

export type BorrowEligibilityProof = {
  claim: string
  contractPayload?: BorrowContractPayload
  expiresAt: string
  id: string
  publicInputs: BorrowProofPublicInputs
  status: BorrowProofStatus
}

export type GenerateBorrowProofParams = {
  account: string | null
  borrow: AssetAmount
  collateral: AssetAmount
  healthFactor: number | null
  healthFactorMin: number
  isEligible: boolean
  market: string
  maxLtv: number
  now?: number
}

export type BorrowProverAdapter = {
  generateBorrowProof: (
    params: GenerateBorrowProofParams,
    signal?: AbortSignal
  ) => Promise<AdapterResult<BorrowEligibilityProof>>
}
