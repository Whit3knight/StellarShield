import { createStableId } from "@/lib/stable-id"

import type {
  BorrowEligibilityProof,
  BorrowProverAdapter,
  GenerateBorrowProofParams,
} from "./types"

const PROOF_TTL_MS = 10 * 60 * 1000

export const mockBorrowProverAdapter: BorrowProverAdapter = {
  generateBorrowProof,
}

export function generateBorrowProof({
  account,
  borrow,
  collateral,
  healthFactorMin,
  isEligible,
  market,
  maxLtv,
  now = Date.now(),
}: GenerateBorrowProofParams): BorrowEligibilityProof {
  return {
    claim: isEligible
      ? "Borrow eligibility verified"
      : "Borrow eligibility failed",
    expiresAt: new Date(now + PROOF_TTL_MS).toISOString(),
    id: createStableId(
      "proof",
      account ?? "disconnected",
      market,
      borrow.symbol,
      borrow.amount,
      collateral.symbol,
      collateral.amount,
      isEligible ? "eligible" : "failed"
    ),
    publicInputs: {
      healthFactorMin: healthFactorMin.toFixed(2),
      market,
      maxLtv: `${Math.round(maxLtv * 100)}%`,
    },
    status: isEligible ? "Verified" : "Failed",
  }
}

