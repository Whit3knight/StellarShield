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

import {
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
    }[] = []
    for (const event of events) {
      const topics = decodeTopicSymbols(sdk, event)
      const timestamp = eventOpenedAt(event)
      if (timestamp === undefined) continue
      decoded.push({
        type: topics[0] ?? "",
        asset1: shieldedAsset(topics[1]),
        asset2: topics[0] === "borrow" ? shieldedAsset(topics[2]) : null,
        isLoan: topics[2] === "loan",
        timestamp,
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

export function undoDelta(
  running: CurrentTotals,
  event: {
    type: string
    asset1: ShieldedAsset | null
    asset2: ShieldedAsset | null
    isLoan: boolean
  }
): void {
  const { type, asset1, asset2, isLoan } = event
  if (type === "deposit" && asset1) {
    running[asset1].totalDeposits -= 1
  } else if (type === "borrow" && asset1 && asset2) {
    // asset1 = collateral (4 notes spent), asset2 = borrow (1 loan note minted).
    running[asset1].totalDeposits += 4
    running[asset2].totalBorrows -= 1
  } else if (type === "withdraw" && asset1) {
    if (isLoan) {
      running[asset1].totalBorrows += 1
    } else {
      running[asset1].totalDeposits += 1
    }
  } else if (type === "repay" && asset1) {
    running[asset1].totalBorrows += 1
    running[asset1].totalDeposits += 1
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
