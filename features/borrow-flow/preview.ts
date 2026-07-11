import type { ConnectedAccount } from "@/app/_constants/account"
import { formatAdapterError } from "@/features/protocol"

import { formatAssetAmount, formatUsd } from "./format"
import { getIntent, getPayload, getProof, getReceipt } from "./types"

function shortHash(hash: string): string {
  // 64-char tx hashes overflow a timeline row; keep the first + last
  // few chars so users can eyeball match against Stellar Expert.
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  TransactionPreview,
} from "./types"

export function createTransactionPreview({
  account,
  flow,
  metrics,
}: {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
}): TransactionPreview {
  const quote = metrics.quote
  const intent = getIntent(flow.transaction)
  const payload = getPayload(flow.transaction)
  const receipt = getReceipt(flow.transaction)
  const error =
    flow.transaction.status === "Failed" && flow.transaction.error
      ? formatAdapterError(flow.transaction.error)
      : null
  const healthFactor =
    quote.healthFactor === null ? "N/A" : quote.healthFactor.toFixed(2)

  return {
    account: account?.wallet.shortAddress ?? "Connect wallet",
    collateral: formatAssetAmount(
      quote.collateral.amount,
      quote.collateral.symbol
    ),
    collateralValue: formatUsd(quote.collateral.valueUsd),
    error,
    estimatedFee: formatAssetAmount(
      quote.estimatedFee.amount,
      quote.estimatedFee.symbol
    ),
    healthFactor,
    intentId: intent?.id ?? "Prepared after verification",
    loan: formatAssetAmount(quote.loan.amount, quote.loan.symbol),
    loanHealth: quote.loanHealth,
    loanValue: formatUsd(quote.loan.valueUsd),
    market: quote.market,
    memo: payload?.memo ?? "Prepared after simulation",
    network: payload?.network ?? "Prepared after simulation",
    operation: payload?.operation ?? "Prepared after simulation",
    proof: getProof(flow.verification)?.id ?? "Required before submission",
    receipt: receipt?.hash ? shortHash(receipt.hash) : null,
    status: flow.transaction.status,
    verification: flow.verification.status,
  }
}
