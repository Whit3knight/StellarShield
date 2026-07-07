import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"

import { COLLATERAL_FACTOR, MARKET_STEPS } from "./constants"
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  LoanHealth,
  MarketStep,
} from "./types"

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
})

export function parseAmount(value: string): number {
  const parsedValue = Number.parseFloat(value.replace(/[^0-9.]/g, ""))

  if (Number.isNaN(parsedValue)) {
    return 0
  }

  return parsedValue
}

export function formatUsd(value: number): string {
  return USD_FORMATTER.format(value)
}

export function getBorrowFlowMetrics(flow: BorrowFlowState): BorrowFlowMetrics {
  const collateralValue = parseAmount(flow.collateralAmount)
  const loanValue = parseAmount(flow.loanAmount)
  const borrowingPower = collateralValue * COLLATERAL_FACTOR
  const utilization = borrowingPower > 0 ? loanValue / borrowingPower : 0
  const isLoanValid =
    collateralValue > 0 && loanValue > 0 && loanValue <= borrowingPower
  const loanHealth: LoanHealth = !isLoanValid
    ? "At risk"
    : utilization > 0.85
      ? "Attention"
      : "Healthy"

  return {
    borrowingPower,
    collateralValue,
    isLoanValid,
    loanHealth,
    loanValue,
    utilization,
  }
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
      description: "Track the submitted borrow transaction.",
      title: "Transaction",
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
