import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import type { ConnectedAccount } from "@/app/_constants/account"
import { getWalletAssetBalance } from "@/features/wallet/utils"

import {
  ASSET_PRICES_USD,
  LIQUIDATION_THRESHOLD,
  MARKET_STEPS,
  MAX_LOAN_TO_VALUE,
  MIN_COLLATERAL_VALUE,
  MIN_LOAN_VALUE,
} from "./constants"
import type {
  BorrowProof,
  BorrowFlowMetrics,
  BorrowFlowState,
  LoanHealth,
  MarketStep,
  UserPosition,
} from "./types"

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
})
const ATTENTION_HEALTH_FACTOR = 1.5

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

export function formatAssetAmount(value: number, symbol: string): string {
  const formattedValue = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: value > 0 && value < 1 ? 2 : 0,
  }).format(value)

  return `${formattedValue} ${symbol}`
}

export function getAssetPriceUsd(symbol: string): number {
  return ASSET_PRICES_USD[symbol] ?? 1
}

export function formatPairPrice(market: MarketCardData): string {
  const basePriceUsd = getAssetPriceUsd(market.symbol)
  const quotePriceUsd = getAssetPriceUsd(market.collateral)
  const pairPrice = quotePriceUsd > 0 ? basePriceUsd / quotePriceUsd : 0
  const formattedPrice = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(pairPrice)

  return `1 ${market.symbol} = ${formattedPrice} ${market.collateral}`
}

export function getCollateralValidationError({
  amount,
  balance,
  hasWallet,
  symbol,
  valueUsd,
}: {
  amount: number
  balance: number
  hasWallet: boolean
  symbol: string
  valueUsd: number
}): string | null {
  if (!hasWallet) {
    return "Connect wallet to continue."
  }

  if (valueUsd < MIN_COLLATERAL_VALUE) {
    return `Collateral value must be at least ${formatUsd(
      MIN_COLLATERAL_VALUE
    )}.`
  }

  if (amount > balance) {
    return `Collateral exceeds available ${symbol} balance.`
  }

  return null
}

export function getLoanValidationError(
  valueUsd: number,
  borrowingPower: number
): string | null {
  if (valueUsd < MIN_LOAN_VALUE) {
    return `Loan amount must be at least ${formatUsd(MIN_LOAN_VALUE)}.`
  }

  if (valueUsd > borrowingPower) {
    return "Loan amount exceeds current borrowing power."
  }

  return null
}

export function getBorrowFlowMetrics(
  flow: BorrowFlowState,
  market: MarketCardData,
  account: ConnectedAccount | null
): BorrowFlowMetrics {
  const collateralAmount = parseAmount(flow.collateralAmount)
  const loanAmount = parseAmount(flow.loanAmount)
  const collateralPriceUsd = getAssetPriceUsd(market.collateral)
  const loanPriceUsd = getAssetPriceUsd(market.symbol)
  const collateralValue = collateralAmount * collateralPriceUsd
  const loanValue = loanAmount * loanPriceUsd
  const borrowingPower = collateralValue * MAX_LOAN_TO_VALUE
  const maxLoanAmount =
    loanPriceUsd > 0 ? borrowingPower / loanPriceUsd : borrowingPower
  const utilization = borrowingPower > 0 ? loanValue / borrowingPower : 0
  const collateralWalletBalance = parseAmount(
    getWalletAssetBalance(account, market.collateral) ?? ""
  )
  const hasWallet = Boolean(account)
  const healthFactor =
    loanValue > 0 ? (collateralValue * LIQUIDATION_THRESHOLD) / loanValue : null
  const liquidationPrice =
    loanValue > 0 && collateralAmount > 0
      ? loanValue / (collateralAmount * LIQUIDATION_THRESHOLD)
      : null
  const collateralError = getCollateralValidationError({
    amount: collateralAmount,
    balance: collateralWalletBalance,
    hasWallet,
    symbol: market.collateral,
    valueUsd: collateralValue,
  })
  const loanError = getLoanValidationError(loanValue, borrowingPower)
  const validationError = collateralError ?? loanError
  const isLoanValid = !validationError && loanAmount > 0 && collateralAmount > 0
  const loanHealth: LoanHealth = !isLoanValid
    ? "At risk"
    : healthFactor !== null && healthFactor < ATTENTION_HEALTH_FACTOR
      ? "Attention"
      : "Healthy"

  return {
    borrowingPower,
    collateralAmount,
    collateralValue,
    collateralWalletBalance,
    hasWallet,
    healthFactor,
    isLoanValid,
    liquidationPrice,
    loanHealth,
    loanAmount,
    loanValue,
    maxLoanAmount,
    validationError,
    utilization,
  }
}

export function createBorrowProof({
  market,
  metrics,
}: {
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): BorrowProof {
  return {
    claim: "Borrow eligibility verified",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    id: `proof-${Date.now().toString(36)}`,
    publicInputs: {
      healthFactorMin: "1.25",
      market: getMarketPair(market),
      maxLtv: `${Math.round(MAX_LOAN_TO_VALUE * 100)}%`,
    },
    status: metrics.isLoanValid ? "Verified" : "Failed",
  }
}

export function createUserPosition({
  market,
  metrics,
}: {
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): UserPosition {
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
    borrowingPowerUsed: metrics.utilization,
    healthFactor: metrics.healthFactor,
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
