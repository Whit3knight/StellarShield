// Reconstructs a per-asset Borrow APR trend from real chain events —
// replaces the flat, always-zero placeholder chart. Reuses the exact
// deposit/borrow/withdraw/repay event decode already proven in
// features/notes/scanner.ts (topic-only, no memo decryption needed:
// we're counting notes per asset, not attributing them to a wallet)
// and the same RPC + indexer event source (features/notes/rpc-events.ts),
// so this survives RPC's ~7-day retention exactly like the Activity
// feature does.
//
// Liquidation is not decoded: v1/v2 underwater proofs are dimensionally
// broken and cannot currently be triggered (see CLAUDE.md), so no
// LIQUIDATE_EVENT can exist on chain today. Add it if/when a v3 circuit
// ships — the same synthetic DEPOSIT_EVENT it also emits for the bounty
// is already covered by the deposit branch below.
//
// Design: replay BACKWARD from the live, view-call-verified current
// totals rather than forward from zero. The indexer's start_at was
// deliberately set just before the first real activity (see
// goldsky/stellar-shield-events.yaml) — it does not hold the contract's
// full history back to genesis — so accumulating forward from an empty
// baseline would understate every bucket. Undoing each event's delta
// walking backward from "now" needs only the current totals (already
// fetched for the live tile) plus whatever's in the retention window.

import { computeBorrowApr } from "./derive-metrics"

import { DENOMINATION } from "@/features/notes"
import {
  decodeEventBody,
  decodeTopicSymbols,
  eventOpenedAt,
  shieldedAsset,
} from "@/features/notes/scanner"
import { fetchAllContractEvents, type RpcEvent } from "@/features/notes/rpc-events"
import { SUPPORTED_ASSETS, type ShieldedAsset } from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

const BUCKET_COUNT = 8
const WINDOW_SECONDS = 7 * 24 * 60 * 60

type AssetTotals = { totalDeposits: number; totalBorrows: number }
type HistoryPoint = { label: string; value: number }

/**
 * Per-asset current totals, as already read by `market-stats.ts`'s
 * live view calls — the anchor this function replays backward from.
 */
export type CurrentTotals = Record<ShieldedAsset, AssetTotals>

export async function fetchMarketHistory(params: {
  currentTotals: CurrentTotals
  rateParams?: { baseApr: number; slopeApr: number }
  signal?: AbortSignal
}): Promise<Record<ShieldedAsset, HistoryPoint[]>> {
  const { currentTotals, rateParams, signal } = params
  const fallback = Object.fromEntries(
    SUPPORTED_ASSETS.map((asset) => [asset, flatHistory(currentTotals[asset], rateParams)])
  ) as Record<ShieldedAsset, HistoryPoint[]>

  const contractId = getConfiguredContractId()
  if (!contractId) return fallback

  let events: RpcEvent[]
  try {
    const sdk = await import("@stellar/stellar-sdk")
    const { rpc } = await import("@stellar/stellar-sdk")
    const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
      allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
    })
    const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
    const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
    const withdrawTopic = sdk.xdr.ScVal.scvSymbol("withdraw").toXDR("base64")
    const repayTopic = sdk.xdr.ScVal.scvSymbol("repay").toXDR("base64")
    const filters = [
      { type: "contract" as const, contractIds: [contractId], topics: [[depositTopic, "*"]] },
      { type: "contract" as const, contractIds: [contractId], topics: [[borrowTopic, "*", "*"]] },
      { type: "contract" as const, contractIds: [contractId], topics: [[withdrawTopic, "*"]] },
      { type: "contract" as const, contractIds: [contractId], topics: [[withdrawTopic, "*", "*"]] },
      { type: "contract" as const, contractIds: [contractId], topics: [[repayTopic, "*"]] },
    ]
    events = await fetchAllContractEvents({ server, filters, signal })

    const decoded: {
      type: string
      asset1: ShieldedAsset | null
      asset2: ShieldedAsset | null
      isLoan: boolean
      timestamp: number
      amount: bigint | null
      collateralAmount: bigint | null
    }[] = []
    for (const event of events) {
      const topics = decodeTopicSymbols(sdk, event)
      const timestamp = eventOpenedAt(event)
      if (timestamp === undefined) continue
      const type = topics[0] ?? ""
      const asset1 = shieldedAsset(topics[1])
      const { amount, collateralAmount } = decodeEventAmounts(
        sdk,
        event,
        type
      )
      decoded.push({
        type,
        asset1,
        asset2: type === "borrow" ? shieldedAsset(topics[2]) : null,
        isLoan: topics[2] === "loan",
        timestamp,
        amount,
        collateralAmount,
      })
    }
    // Newest first — we walk backward from "now", undoing each delta.
    decoded.sort((a, b) => b.timestamp - a.timestamp)

    const now = Math.floor(Date.now() / 1000)
    const boundaries = bucketBoundaries(now)

    const running: CurrentTotals = {
      XLM: { ...currentTotals.XLM },
      USDC: { ...currentTotals.USDC },
      EURC: { ...currentTotals.EURC },
    }
    const perAssetBuckets: Record<ShieldedAsset, number[]> = {
      XLM: [],
      USDC: [],
      EURC: [],
    }

    let eventIndex = 0
    // boundaries[7] = now (already the anchor); walk from newest bucket
    // to oldest, undoing events strictly newer than each boundary.
    for (let b = BUCKET_COUNT - 1; b >= 0; b--) {
      while (
        eventIndex < decoded.length &&
        decoded[eventIndex].timestamp >= boundaries[b]
      ) {
        undoDelta(running, decoded[eventIndex])
        eventIndex++
      }
      for (const asset of SUPPORTED_ASSETS) {
        perAssetBuckets[asset][b] = computeBorrowApr(
          running[asset].totalDeposits,
          running[asset].totalBorrows,
          rateParams
        ) * 100
      }
    }

    const result = {} as Record<ShieldedAsset, HistoryPoint[]>
    for (const asset of SUPPORTED_ASSETS) {
      result[asset] = perAssetBuckets[asset].map((value, index) => ({
        label: String(index),
        value,
      }))
    }
    return result
  } catch {
    return fallback
  }
}

/**
 * Extracts the real amount(s) an event carries, in RAW token units —
 * `null` when the event predates the field it needs (pre-R17 events
 * still in the RPC retention window) or, for repay, always (repay's
 * amounts are private circuit witnesses with no public signal at all;
 * this is a permanent limitation, not a decode gap — see
 * `docs/REMEDIATION.md` R17's note on `repay_shielded` not adjusting
 * the value counters either). Callers fall back to `DENOMINATION` for
 * `null`, same convention `undoDelta` already used before real
 * amounts existed.
 */
function decodeEventAmounts(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent,
  type: string
): { amount: bigint | null; collateralAmount: bigint | null } {
  const body = decodeEventBody(sdk, event)
  if (!body) return { amount: null, collateralAmount: null }
  const toBigint = (raw: unknown): bigint | null => {
    if (typeof raw === "bigint") return raw
    if (typeof raw === "number") return BigInt(raw)
    return null
  }
  if (type === "deposit") {
    // (index, root, leaf, memo, amount) post-R17; 4 elements pre-R17.
    return { amount: toBigint(body[4]), collateralAmount: null }
  }
  if (type === "borrow") {
    // R20: (index, root, leaf, memo, n0..n3, collateral_pedersen_u,
    // collateral_pedersen_v, loan_pedersen_u, loan_pedersen_v) — 12
    // elements, body[8..11] are BytesN<32> Jubjub coordinates, not
    // amounts. total_collateral_amount/borrow_amount are pure private
    // witnesses now (see borrow.circom's R20 header comment) — there
    // is no public amount left to decode at all, permanently (not a
    // decode gap; `undoDelta` already has the DENOMINATION fallback
    // wired for exactly this case). Pre-R20 shapes: 10 elements
    // (post-R19, body[8]/body[9] were real numeric amounts), 9
    // (post-R17), 8 (pre-R17).
    if (body.length >= 12) {
      return { amount: null, collateralAmount: null }
    }
    return {
      amount: toBigint(body[8]),
      collateralAmount: toBigint(body[9]),
    }
  }
  if (type === "withdraw") {
    // (nullifier_bytes, to, amount) — both variants, always 3.
    return { amount: toBigint(body[2]), collateralAmount: null }
  }
  return { amount: null, collateralAmount: null }
}

export function undoDelta(
  running: CurrentTotals,
  event: {
    type: string
    asset1: ShieldedAsset | null
    asset2: ShieldedAsset | null
    isLoan: boolean
    amount?: bigint | null
    collateralAmount?: bigint | null
  }
): void {
  const { type, asset1, asset2, isLoan, amount, collateralAmount } = event
  const amountValue = (asset: ShieldedAsset, value: bigint | null | undefined) =>
    Number(value ?? DENOMINATION[asset])
  if (type === "deposit" && asset1) {
    running[asset1].totalDeposits -= amountValue(asset1, amount)
  } else if (type === "borrow" && asset1 && asset2) {
    // asset1 = collateral (4 notes spent), asset2 = borrow (1 loan note minted).
    running[asset1].totalDeposits += Number(
      collateralAmount ?? DENOMINATION[asset1] * 4n
    )
    running[asset2].totalBorrows -= amountValue(asset2, amount)
  } else if (type === "withdraw" && asset1) {
    if (isLoan) {
      running[asset1].totalBorrows += amountValue(asset1, amount)
    } else {
      running[asset1].totalDeposits += amountValue(asset1, amount)
    }
  } else if (type === "repay" && asset1) {
    // repay_shielded never publishes an amount (private witness, no
    // public signal — see docs/REMEDIATION.md R17) and the contract's
    // own total_deposit_value/total_borrow_value counters don't adjust
    // on repay either, so this flat-denomination approximation is
    // consistent with the on-chain source of truth's own limitation,
    // not a gap this function could close on its own.
    running[asset1].totalBorrows += Number(DENOMINATION[asset1])
    running[asset1].totalDeposits += Number(DENOMINATION[asset1])
  }
}

/** 8 boundaries spanning the RPC retention window, oldest to newest. */
export function bucketBoundaries(nowSeconds: number): number[] {
  const step = WINDOW_SECONDS / (BUCKET_COUNT - 1)
  return Array.from({ length: BUCKET_COUNT }, (_, i) =>
    Math.floor(nowSeconds - (BUCKET_COUNT - 1 - i) * step)
  )
}

function flatHistory(
  totals: AssetTotals | undefined,
  rateParams?: { baseApr: number; slopeApr: number }
): HistoryPoint[] {
  const value =
    computeBorrowApr(totals?.totalDeposits ?? 0, totals?.totalBorrows ?? 0, rateParams) * 100
  return Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    label: String(i),
    value,
  }))
}
