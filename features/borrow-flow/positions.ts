import type { MarketCardData } from "@/features/markets"
import { getMarketPair } from "@/features/markets"
import type { ProtocolTransactionReceipt } from "@/features/protocol"
import { createStableId } from "@/lib/stable-id"

import { getIntent } from "./types"
import type { BorrowFlowMetrics, BorrowFlowState, UserPosition } from "./types"

const NEXT_PAYMENT_DAYS = 30

export function createUserPosition({
  flow,
  market,
  metrics,
  receipt,
  now = Date.now(),
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  now?: number
  receipt: ProtocolTransactionReceipt
}): UserPosition {
  const openedAt = new Date(now).toISOString()
  const nextPaymentDue = new Date(
    now + NEXT_PAYMENT_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  return {
    borrowed:
      metrics.loanAmount > 0
        ? [
            {
              amount: metrics.loanAmount,
              symbol: market.symbol,
              valueUsd: metrics.loanValue,
            },
          ]
        : [],
    borrowApr: market.borrowApr,
    borrowingPowerUsed: metrics.utilization,
    healthFactor: metrics.healthFactor,
    id: createStableId(
      "position",
      getIntent(flow.transaction)?.id ?? "missing-intent",
      receipt.hash
    ),
    market: getMarketPair(market),
    nextPaymentDue,
    openedAt,
    receiptHash: receipt.hash,
    status: "Open",
    supplied:
      metrics.collateralAmount > 0
        ? [
            {
              amount: metrics.collateralAmount,
              symbol: market.collateral,
              valueUsd: metrics.collateralValue,
            },
          ]
        : [],
  }
}
