import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import { formatAssetAmount, formatUsd } from "./format"
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  TransactionPreview,
} from "./types"

export function createTransactionPreview({
  account,
  flow,
  market,
  metrics,
}: {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): TransactionPreview {
  const quote = metrics.quote
  const payload = flow.transactionPayload
  const healthFactor =
    quote.healthFactor === null ? "N/A" : quote.healthFactor.toFixed(2)

  return {
    account: account?.wallet.shortAddress ?? "Connect wallet",
    borrowApr: market.borrowApr,
    collateral: formatAssetAmount(
      quote.collateral.amount,
      quote.collateral.symbol
    ),
    collateralValue: formatUsd(quote.collateral.valueUsd),
    estimatedFee: formatAssetAmount(
      quote.estimatedFee.amount,
      quote.estimatedFee.symbol
    ),
    healthFactor,
    intentId: flow.borrowIntent?.id ?? "Prepared after verification",
    loan: formatAssetAmount(quote.loan.amount, quote.loan.symbol),
    loanHealth: quote.loanHealth,
    loanValue: formatUsd(quote.loan.valueUsd),
    market: quote.market,
    memo: payload?.memo ?? "Prepared after simulation",
    network: payload?.network ?? "Prepared after simulation",
    operation: payload?.operation ?? "Prepared after simulation",
    proof: flow.proof?.id ?? "Required before submission",
    receipt: flow.transactionReceipt?.hash ?? null,
    simulation: flow.simulationStatus,
    status: flow.transactionStatus,
    verification: flow.verificationStatus,
  }
}
