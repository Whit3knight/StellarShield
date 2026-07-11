import type { BorrowEligibilityProof } from "@/features/proofs"
import type { ChainBorrowReceipt } from "@/features/protocol"

import type { BorrowActivity } from "./types"

const HISTORY_CAP = 50

/**
 * Combine chain events (confirmed transactions) with locally-kept
 * proofs (chain stores proof_id but not generation time). Dedup by
 * activity id; sort newest first; cap at HISTORY_CAP.
 */
export function deriveActivities({
  chainReceipts,
  proofs,
}: {
  chainReceipts: ChainBorrowReceipt[]
  proofs: BorrowEligibilityProof[]
}): BorrowActivity[] {
  const merged: BorrowActivity[] = []
  const seen = new Set<string>()

  for (const receipt of chainReceipts) {
    const activity = chainReceiptToActivity(receipt)
    if (seen.has(activity.id)) continue
    seen.add(activity.id)
    merged.push(activity)
  }

  for (const proof of proofs) {
    const activity = proofToActivity(proof)
    if (seen.has(activity.id)) continue
    seen.add(activity.id)
    merged.push(activity)
  }

  merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return merged.slice(0, HISTORY_CAP)
}

function chainReceiptToActivity(receipt: ChainBorrowReceipt): BorrowActivity {
  const timestamp = new Date(receipt.confirmedAt * 1000).toISOString()
  return {
    description: "Borrow position opened from the confirmed testnet receipt.",
    id: `chain-confirmed-${receipt.proofId}`,
    privateValue: true,
    status: "completed",
    timestamp,
    title: "Transaction confirmed",
    type: "transaction_confirmed",
    value: receipt.proofId,
  }
}

function proofToActivity(proof: BorrowEligibilityProof): BorrowActivity {
  return {
    description: "Eligibility proof was generated locally.",
    id: `proof-generated-${proof.id}`,
    privateValue: true,
    status: proof.status === "Verified" ? "completed" : "failed",
    timestamp: proof.generatedAt ?? proof.expiresAt,
    title: "Proof generated",
    type: "proof_generated",
    value: proof.id,
  }
}
