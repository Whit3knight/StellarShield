import type { ConnectedAccount } from "@/app/_constants/account"
import { getMarketPair, type MarketCardData } from "@/features/markets"
import {
  type AdapterResult,
  type BorrowIntent,
  err,
  mockProtocolAdapter,
  ok,
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

export async function generateProof({
  account,
  market,
  metrics,
  prover = mockBorrowProverAdapter,
  signal,
}: {
  account: ConnectedAccount | null
  market: MarketCardData
  metrics: BorrowFlowMetrics
  prover?: BorrowProverAdapter
  signal?: AbortSignal
}): Promise<AdapterResult<BorrowProof>> {
  return prover.generateBorrowProof(
    {
      account: account?.wallet.address ?? null,
      borrow: metrics.quote.loan,
      collateral: metrics.quote.collateral,
      healthFactor: metrics.healthFactor,
      healthFactorMin: HEALTH_FACTOR_MIN,
      isEligible: metrics.isLoanValid,
      market: getMarketPair(market),
      maxLtv: MAX_LOAN_TO_VALUE,
    },
    signal
  )
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

export async function createBorrowIntentFromFlow({
  account,
  adapter = mockProtocolAdapter,
  metrics,
  proof,
  signal,
}: {
  adapter?: ProtocolAdapter
  account: ConnectedAccount | null
  metrics: BorrowFlowMetrics
  proof: BorrowProof | null
  signal?: AbortSignal
}): Promise<AdapterResult<BorrowIntent | null>> {
  if (
    !account ||
    !proof ||
    proof.status !== "Verified" ||
    !metrics.isLoanValid
  ) {
    return ok(null)
  }

  return adapter.createBorrowIntent(
    {
      account: account.wallet.address,
      borrow: metrics.quote.loan,
      collateral: metrics.quote.collateral,
      expiresAt: proof.expiresAt,
      healthFactor: metrics.quote.healthFactor,
      market: metrics.quote.market,
      maxLtv: MAX_LOAN_TO_VALUE,
      proofId: proof.id,
    },
    signal
  )
}

export async function simulateBorrowIntentFromFlow({
  adapter = mockProtocolAdapter,
  intent,
  metrics,
  signal,
}: {
  adapter?: ProtocolAdapter
  intent: BorrowIntent | null
  metrics: BorrowFlowMetrics
  signal?: AbortSignal
}): Promise<AdapterResult<ProtocolTransactionPayload | null>> {
  if (!intent) {
    return err({
      tag: "InvalidInput",
      field: "intent",
      message: "Borrow intent is required before simulation.",
    })
  }

  return adapter.simulateBorrow(
    {
      fee: metrics.quote.estimatedFee,
      intent,
    },
    signal
  )
}
