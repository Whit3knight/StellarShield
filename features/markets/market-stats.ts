import {
  getConfiguredContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Contract-level market stats derived from ("borrow",) and ("repay",)
// events on the borrow-pool contract. Aggregates across every account
// so a market card can show real activity numbers instead of the
// hardcoded APR / TVL / utilization strings the skeleton pool can't
// compute yet.

export type MarketStat = {
  chart: { label: string; value: number }[]
  latestActivityAt: number | null
  openPositions: number
  totalBorrows: number
  totalRepays: number
}

// Number of buckets for the mini chart (open-position count sampled
// across the event window). 8 fits nicely on the market card without
// over-quantising the ~24h retention range.
const CHART_BUCKETS = 8

// Testnet event retention window is ~24h @ 5s per ledger. Stay a bit
// under so we never hit "ledger not found".
const LEDGER_LOOKBACK = 16_500
const EVENT_PAGE_LIMIT = 500

type ScValLike = {
  toXDR: (encoding?: string) => string
}

/**
 * Fetch every borrow + repay event in the current retention window
 * from the deployed contract, aggregate by market pair, and return a
 * lookup keyed by `${borrow_symbol}/${collateral_symbol}`.
 */
export async function fetchMarketStats(
  signal?: AbortSignal
): Promise<Record<string, MarketStat>> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) return {}

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const repayTopic = sdk.xdr.ScVal.scvSymbol("repay").toXDR("base64")

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[borrowTopic]],
        },
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[repayTopic]],
        },
      ],
      startLedger,
      limit: EVENT_PAGE_LIMIT,
    })
  } catch {
    return {}
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)

  // Bucket window covers the full retention range; each bucket carries
  // the same number of seconds so the chart is a straight histogram of
  // borrow activity per pair.
  const nowSecs = Math.floor(Date.now() / 1000)
  const windowSecs = LEDGER_LOOKBACK * 5
  const bucketSecs = Math.max(1, Math.floor(windowSecs / CHART_BUCKETS))
  const windowStart = nowSecs - windowSecs

  const stats: Record<string, MarketStat> = {}

  for (const event of events) {
    const topic = decodeTopic(sdk, event)
    const receipt = decodeReceipt(sdk, event)
    if (!receipt || (topic !== "borrow" && topic !== "repay")) continue

    const pair = `${receipt.borrowSymbol}/${receipt.collateralSymbol}`
    const bucket =
      stats[pair] ??
      ({
        chart: makeEmptyChart(),
        latestActivityAt: null,
        openPositions: 0,
        totalBorrows: 0,
        totalRepays: 0,
      } satisfies MarketStat)

    if (topic === "borrow") {
      bucket.totalBorrows += 1
      bucket.openPositions += 1
    } else {
      bucket.totalRepays += 1
      bucket.openPositions = Math.max(0, bucket.openPositions - 1)
    }

    if (
      bucket.latestActivityAt === null ||
      receipt.confirmedAt > bucket.latestActivityAt
    ) {
      bucket.latestActivityAt = receipt.confirmedAt
    }

    if (topic === "borrow" && receipt.confirmedAt >= windowStart) {
      const offset = receipt.confirmedAt - windowStart
      const bucketIndex = Math.min(
        CHART_BUCKETS - 1,
        Math.max(0, Math.floor(offset / bucketSecs))
      )
      bucket.chart[bucketIndex].value += 1
    }

    stats[pair] = bucket
  }

  return stats
}

function makeEmptyChart(): { label: string; value: number }[] {
  return Array.from({ length: CHART_BUCKETS }, (_, index) => ({
    label: `-${CHART_BUCKETS - index}`,
    value: 0,
  }))
}

function extractEvents(response: unknown): { topic?: unknown[]; topics?: unknown[]; value?: unknown }[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as { value?: unknown }[]) : []
}

function decodeTopic(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: { topic?: unknown[]; topics?: unknown[] }
): string | null {
  const list =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  if (list.length === 0) return null
  const first = toScVal(sdk, list[0])
  if (!first) return null

  try {
    const native = sdk.scValToNative(first)
    return typeof native === "string" ? native : null
  } catch {
    return null
  }
}

function decodeReceipt(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: { value?: unknown }
): {
  account: string
  borrowSymbol: string
  collateralSymbol: string
  confirmedAt: number
  market: string
} | null {
  const scVal = toScVal(sdk, event.value)
  if (!scVal) return null

  let native: unknown
  try {
    native = sdk.scValToNative(scVal)
  } catch {
    return null
  }
  if (!native || typeof native !== "object") return null

  const r = native as {
    account?: string
    borrow_symbol?: string
    collateral_symbol?: string
    confirmed_at?: bigint | number
    market?: string
  }

  if (
    typeof r.account !== "string" ||
    typeof r.borrow_symbol !== "string" ||
    typeof r.collateral_symbol !== "string" ||
    typeof r.market !== "string" ||
    r.confirmed_at === undefined
  ) {
    return null
  }

  return {
    account: r.account,
    borrowSymbol: r.borrow_symbol,
    collateralSymbol: r.collateral_symbol,
    confirmedAt: Number(r.confirmed_at),
    market: r.market,
  }
}

function toScVal(
  sdk: typeof import("@stellar/stellar-sdk"),
  value: unknown
): InstanceType<typeof sdk.xdr.ScVal> | null {
  if (typeof value === "string") {
    try {
      return sdk.xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && typeof (value as ScValLike).toXDR === "function") {
    return value as InstanceType<typeof sdk.xdr.ScVal>
  }
  return null
}
