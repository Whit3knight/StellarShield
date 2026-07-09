import { getMarketPair, type MarketCardData } from "@/features/markets"

import { MARKET_STEPS } from "./constants"
import type { MarketStep, VerificationStatus } from "./types"

export function isVerificationPending(status: VerificationStatus): boolean {
  return status === "Preparing" || status === "Generating proof"
}

export function getStepCopy(
  market: MarketCardData,
  step: MarketStep
): { description: string; title: string } {
  if (step === "collateral") {
    return {
      description: "Add collateral and choose the loan amount for this market.",
      title: "Add collateral",
    }
  }

  if (step === "verification") {
    return {
      description: "Confirm eligibility without exposing wallet details.",
      title: "Private verification",
    }
  }

  if (step === "transaction") {
    return {
      description: "Review the borrow request before wallet signature.",
      title: "Review transaction",
    }
  }

  return {
    description:
      "Public market details are visible before connecting a wallet.",
    title: getMarketPair(market),
  }
}

export function getStepIndex(step: MarketStep): number {
  return MARKET_STEPS.indexOf(step)
}
