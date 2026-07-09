import type { ConnectedAccount } from "@/app/_constants/account"
import { getMarketPair, type MarketCardData } from "@/features/markets"
import {
  type BorrowIntent,
  mockProtocolAdapter,
  type ProtocolAdapter,
  type ProtocolTransactionPayload,
} from "@/features/protocol"
import {
  type BorrowProverAdapter,
  mockBorrowProverAdapter,
} from "@/features/proofs"

import { HEALTH_FACTOR_MIN, MAX_LOAN_TO_VALUE } from "./constants"
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  BorrowProof,
  VerificationStatus,
} from "./types"

export function createBorrowProof({
  account,
  market,
  metrics,
  prover = mockBorrowProverAdapter,
}: {
  account: ConnectedAccount | null
  market: MarketCardData
  metrics: BorrowFlowMetrics
  prover?: BorrowProverAdapter
}): BorrowProof {
  return prover.generateBorrowProof({
    account: account?.wallet.address ?? null,
    borrow: metrics.quote.loan,
    collateral: metrics.quote.collateral,
    healthFactor: metrics.healthFactor,
    healthFactorMin: HEALTH_FACTOR_MIN,
    isEligible: metrics.isLoanValid,
    market: getMarketPair(market),
    maxLtv: MAX_LOAN_TO_VALUE,
  })
}

export function canSubmitTransaction({
  metrics,
  simulationStatus,
  status,
  transactionPayload,
}: {
  metrics: BorrowFlowMetrics
  simulationStatus: BorrowFlowState["simulationStatus"]
  status: VerificationStatus
  transactionPayload: ProtocolTransactionPayload | null
}): boolean {
  return (
    status === "Verified" &&
    metrics.isLoanValid &&
    simulationStatus === "Ready" &&
    transactionPayload !== null
  )
}

export function createBorrowIntentFromFlow({
  account,
  adapter = mockProtocolAdapter,
  metrics,
  proof,
}: {
  adapter?: ProtocolAdapter
  account: ConnectedAccount | null
  metrics: BorrowFlowMetrics
  proof: BorrowProof | null
}): BorrowIntent | null {
  if (
    !account ||
    !proof ||
    proof.status !== "Verified" ||
    !metrics.isLoanValid
  ) {
    return null
  }

  return adapter.createBorrowIntent({
    account: account.wallet.address,
    borrow: metrics.quote.loan,
    collateral: metrics.quote.collateral,
    expiresAt: proof.expiresAt,
    healthFactor: metrics.quote.healthFactor,
    market: metrics.quote.market,
    maxLtv: MAX_LOAN_TO_VALUE,
    proofId: proof.id,
  })
}

export function simulateBorrowIntentFromFlow({
  adapter = mockProtocolAdapter,
  intent,
  metrics,
}: {
  adapter?: ProtocolAdapter
  intent: BorrowIntent | null
  metrics: BorrowFlowMetrics
}) {
  return adapter.simulateBorrow({
    fee: metrics.quote.estimatedFee,
    intent,
  })
}
