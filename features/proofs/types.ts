import type { ProtocolAssetAmount } from "@/features/protocol"

export type BorrowProofStatus = "Failed" | "Verified"

export type BorrowProofPublicInputs = {
  healthFactorMin: string
  market: string
  maxLtv: string
}

export type BorrowEligibilityProof = {
  claim: string
  expiresAt: string
  id: string
  publicInputs: BorrowProofPublicInputs
  status: BorrowProofStatus
}

export type GenerateBorrowProofParams = {
  account: string | null
  borrow: ProtocolAssetAmount
  collateral: ProtocolAssetAmount
  healthFactor: number | null
  healthFactorMin: number
  isEligible: boolean
  market: string
  maxLtv: number
  now?: number
}

export type BorrowProverAdapter = {
  generateBorrowProof: (
    params: GenerateBorrowProofParams
  ) => BorrowEligibilityProof
}
