// Local activity log: one record per shielded operation this wallet's
// account performed, derived from the SAME event pass scanner.ts
// already runs for the note inventory — not a second independent
// fetch. Deposit/borrow attribution comes from successfully decrypting
// the event's memo (proves note ownership, same as the inventory
// build); withdraw/repay/liquidate attribution comes from the caller
// address the contract emits directly in the event body
// (`to`/`from`/`liquidator`) — those three move real tokens to/from a
// real Stellar account, so the address is public by construction,
// unlike deposit/borrow (verified: stellar-sdk's scValToNative decodes
// an scvAddress via `Address.fromScVal(scv).toString()`, so the body
// field is already a comparable G-address string).

import type { ShieldedAsset } from "./note"

export type ShieldedActivityType =
  | "deposit"
  | "borrow"
  | "withdraw"
  | "repay"
  | "liquidate"

export type ShieldedActivity = {
  amount?: bigint
  asset: ShieldedAsset
  id: string
  timestamp?: number
  txHash?: string
  type: ShieldedActivityType
}

export type SerializedActivity = {
  amount?: string
  asset: string
  id: string
  timestamp?: number
  txHash?: string
  type: string
}

const HISTORY_CAP = 100

export function serializeActivity(
  activity: ShieldedActivity
): SerializedActivity {
  return {
    amount: activity.amount?.toString(),
    asset: activity.asset,
    id: activity.id,
    timestamp: activity.timestamp,
    txHash: activity.txHash,
    type: activity.type,
  }
}

export function deserializeActivity(
  row: SerializedActivity
): ShieldedActivity | null {
  const asset = row.asset
  if (asset !== "XLM" && asset !== "USDC" && asset !== "EURC") return null
  const type = row.type
  if (
    type !== "deposit" &&
    type !== "borrow" &&
    type !== "withdraw" &&
    type !== "repay" &&
    type !== "liquidate"
  ) {
    return null
  }
  return {
    amount: row.amount !== undefined ? BigInt(row.amount) : undefined,
    asset,
    id: row.id,
    timestamp: row.timestamp,
    txHash: row.txHash,
    type,
  }
}

/**
 * Merge freshly scanned activity with the previous cache: unique by
 * id, newest first, capped. Append-only — unlike notes there is no
 * "spent" state to reconcile, so this is a plain union and trim.
 */
export function mergeActivities(
  previous: ShieldedActivity[],
  fresh: ShieldedActivity[]
): ShieldedActivity[] {
  const byId = new Map<string, ShieldedActivity>()
  for (const activity of previous) byId.set(activity.id, activity)
  for (const activity of fresh) byId.set(activity.id, activity)
  return [...byId.values()]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, HISTORY_CAP)
}
