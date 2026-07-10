import type { AdapterResult } from "@/features/protocol"
import type { AssetAmount } from "@/features/shared/asset-amount"

export type BorrowProofStatus = "Failed" | "Verified"

export type BorrowProofPublicInputs = {
  healthFactorMin: string
  market: string
  maxLtv: string
}

/**
 * Serialized Groth16 proof (192 bytes) plus the on-chain oracle bindings
 * required by the borrow-pool contract. Attached by the Noir prover;
 * the mock prover leaves it `undefined` — mock proofs never reach a real
 * contract call.
 */
export type BorrowContractPayload = {
  oracleEpoch: number
  oraclePriceCommitment: Uint8Array
  proofBytes: Uint8Array
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
