import type { ConnectedAccount } from "@/app/_constants/account"
import type { BorrowIntent } from "@/features/protocol"

import type {
  BorrowActivity,
  BorrowActivityStatus,
  BorrowActivityType,
  BorrowProof,
  TransactionStatus,
  UserPosition,
} from "./types"
import { createStableId } from "@/lib/stable-id"

// ponytail: create* factories below still hardcode these strings.
// Migrate factories to read from this map when a second string source
// (i18n, template renderer) shows up.
export const ACTIVITY_TYPE_LABELS: Record<BorrowActivityType, string> = {
  borrow_intent_prepared: "Borrow intent prepared",
  proof_generated: "Proof generated",
  transaction_confirmed: "Transaction confirmed",
  transaction_submitted: "Transaction submitted",
  wallet_connected: "Wallet connected",
}

export function createBorrowActivity({
  description,
  privateValue = false,
  status = "completed",
  timestamp = new Date().toISOString(),
  title,
  type,
  value,
}: {
  description: string
  privateValue?: boolean
  status?: BorrowActivityStatus
  timestamp?: string
  title: string
  type: BorrowActivityType
  value?: string
}): BorrowActivity {
  return {
    description,
    id: createStableId("activity", type, title, timestamp, value ?? ""),
    privateValue,
    status,
    timestamp,
    title,
    type,
    value,
  }
}

export function appendBorrowActivity(
  activity: BorrowActivity[],
  nextActivity: BorrowActivity
): BorrowActivity[] {
  if (activity.some((item) => item.id === nextActivity.id)) {
    return activity
  }

  return [nextActivity, ...activity].slice(0, 8)
}

export function createConfirmedPositionActivity({
  position,
  timestamp,
}: {
  position: UserPosition
  timestamp?: string
}): BorrowActivity {
  return createBorrowActivity({
    description: "Borrow position opened from the confirmed testnet receipt.",
    privateValue: true,
    status: "completed",
    timestamp,
    title: "Transaction confirmed",
    type: "transaction_confirmed",
    value: position.receiptHash,
  })
}

export function createWalletConnectedActivity({
  account,
  timestamp,
}: {
  account: ConnectedAccount
  timestamp?: string
}): BorrowActivity {
  return createBorrowActivity({
    description: "Wallet address and balances are available for this market.",
    privateValue: true,
    timestamp,
    title: "Wallet connected",
    type: "wallet_connected",
    value: account.wallet.shortAddress,
  })
}

export function createProofGeneratedActivity({
  proof,
  timestamp,
}: {
  proof: BorrowProof
  timestamp?: string
}): BorrowActivity {
  return createBorrowActivity({
    description: "Eligibility proof was generated locally.",
    privateValue: true,
    status: proof.status === "Verified" ? "completed" : "failed",
    timestamp,
    title: "Proof generated",
    type: "proof_generated",
    value: proof.id,
  })
}

export function createIntentPreparedActivity({
  intent,
  timestamp,
}: {
  intent: BorrowIntent
  timestamp?: string
}): BorrowActivity {
  return createBorrowActivity({
    description: "Borrow intent is ready for transaction review.",
    privateValue: true,
    timestamp,
    title: "Borrow intent prepared",
    type: "borrow_intent_prepared",
    value: intent.id,
  })
}

export function createTransactionSubmittedActivity({
  status,
  timestamp,
}: {
  status: TransactionStatus
  timestamp?: string
}): BorrowActivity {
  return createBorrowActivity({
    description: "Transaction is waiting for wallet signature and testnet relay.",
    status: "pending",
    timestamp,
    title: "Transaction submitted",
    type: "transaction_submitted",
    value: status,
  })
}
