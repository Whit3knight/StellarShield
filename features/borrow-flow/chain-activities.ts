import type { BorrowEligibilityProof } from "@/features/proofs"
import type { ChainBorrowReceipt } from "@/features/protocol"

import type { BorrowActivity } from "./types"

const HISTORY_CAP = 50

/**
 * Combine three activity sources into a single time-ordered feed:
 *   - chain events → confirmed transactions (authoritative)
 *   - session proofs → proof-generation entries (chain has no such event)
 *   - session-local activity fallback → wallet connections, ephemeral
 *     submitted states, or anything the flow logs client-side that the
 *     chain won't emit.
 *
 * Dedup by activity id — chain-derived entries win over session ones
 * for the same proof because they carry the confirmed timestamp.
 */
export function deriveActivities({
  chainReceipts,
  proofs,
  sessionActivities,
}: {
  chainReceipts: ChainBorrowReceipt[]
  proofs: BorrowEligibilityProof[]
  sessionActivities: BorrowActivity[]
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

  for (const activity of sessionActivities) {
    if (
      activity.type === "transaction_confirmed" ||
      activity.type === "proof_generated"
    ) {
      // authoritative sources already covered these — skip stale local copies
      continue
    }
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
