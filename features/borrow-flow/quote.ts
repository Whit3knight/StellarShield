import type { ConnectedAccount } from "@/app/_constants/account"
import {
  getAsset,
  getAssetPriceUsd,
  getMarketPair,
  type MarketCardData,
} from "@/features/markets"
import {
  div,
  divToNumber,
  fromNumber,
  fromString,
  isZero,
  mulNumber,
  toNumber,
} from "@/features/shared/money"
import { getWalletAssetBalance } from "@/features/wallet/utils"

import {
  ESTIMATED_TRANSACTION_FEE_XLM,
  LIQUIDATION_THRESHOLD,
  MAX_LOAN_TO_VALUE,
} from "./constants"
import { parseAmount } from "./format"
import {
  getCollateralValidationError,
  getLoanValidationError,
} from "./validation"
import type {
  BorrowFlowMetrics,
  BorrowFlowState,
  BorrowQuote,
  LoanHealth,
} from "./types"

const ATTENTION_HEALTH_FACTOR = 1.5
const USD_DECIMALS = 2
const FEE_USD_DECIMALS = 8

export function createBorrowQuote({
  account,
  flow,
  market,
}: {
  account: ConnectedAccount | null
  flow: Pick<BorrowFlowState, "collateralAmount" | "loanAmount">
  market: MarketCardData
}): BorrowQuote {
  const collateralAsset = getAsset(market.collateral)
  const loanAsset = getAsset(market.symbol)
  const feeAsset = getAsset("XLM")
  const collateralAmountDecimal = fromString(
    flow.collateralAmount,
    collateralAsset.decimals
  )
  const loanAmountDecimal = fromString(flow.loanAmount, loanAsset.decimals)
  const collateralAmount = toNumber(collateralAmountDecimal)
  const loanAmount = toNumber(loanAmountDecimal)
  const collateralPriceUsd = getAssetPriceUsd(market.collateral)
  const loanPriceUsd = getAssetPriceUsd(market.symbol)
  const feePriceUsd = getAssetPriceUsd("XLM")
  const collateralValueDecimal = mulNumber(
    collateralAmountDecimal,
    collateralPriceUsd,
    USD_DECIMALS
  )
  const loanValueDecimal = mulNumber(
    loanAmountDecimal,
    loanPriceUsd,
    USD_DECIMALS
  )
  const borrowingPowerDecimal = mulNumber(
    collateralValueDecimal,
    MAX_LOAN_TO_VALUE,
    USD_DECIMALS
  )
  const collateralValue = toNumber(collateralValueDecimal)
  const loanValue = toNumber(loanValueDecimal)
  const borrowingPower = toNumber(borrowingPowerDecimal)
  const maxLoanAmount =
    loanPriceUsd > 0
      ? toNumber(
          div(
            borrowingPowerDecimal,
            fromNumber(loanPriceUsd, 12),
            loanAsset.decimals
          )
        )
      : borrowingPower
  const utilization = isZero(borrowingPowerDecimal)
    ? 0
    : divToNumber(loanValueDecimal, borrowingPowerDecimal)
  const collateralWalletBalance = parseAmount(
    getWalletAssetBalance(account, market.collateral) ?? ""
  )
  const hasWallet = Boolean(account)
  const healthFactor = isZero(loanValueDecimal)
    ? null
    : divToNumber(
        mulNumber(collateralValueDecimal, LIQUIDATION_THRESHOLD, USD_DECIMALS),
        loanValueDecimal
      )
  const liquidationPrice =
    isZero(loanValueDecimal) || isZero(collateralAmountDecimal)
      ? null
      : divToNumber(
          loanValueDecimal,
          mulNumber(
            collateralAmountDecimal,
            LIQUIDATION_THRESHOLD,
            collateralAsset.decimals
          )
        )
  const feeAmountDecimal = fromNumber(
    ESTIMATED_TRANSACTION_FEE_XLM,
    feeAsset.decimals
  )
  const feeValueUsd = toNumber(
    mulNumber(feeAmountDecimal, feePriceUsd, FEE_USD_DECIMALS)
  )
  const collateralError = getCollateralValidationError({
    amount: collateralAmount,
    balance: collateralWalletBalance,
    hasWallet,
    symbol: market.collateral,
    valueUsd: collateralValue,
  })
  const loanError = getLoanValidationError(loanValue, borrowingPower)
  const validationError = collateralError ?? loanError
  const isLoanValid =
    !validationError &&
    !isZero(loanAmountDecimal) &&
    !isZero(collateralAmountDecimal)
  const loanHealth: LoanHealth = !isLoanValid
    ? "At risk"
    : healthFactor !== null && healthFactor < ATTENTION_HEALTH_FACTOR
      ? "Attention"
      : "Healthy"

  return {
    borrowingPower,
    collateral: {
      amount: collateralAmount,
      symbol: market.collateral,
      valueUsd: collateralValue,
    },
    collateralWalletBalance,
    estimatedFee: {
      amount: ESTIMATED_TRANSACTION_FEE_XLM,
      symbol: "XLM",
      valueUsd: feeValueUsd,
    },
    healthFactor,
    liquidationPrice,
    loan: {
      amount: loanAmount,
      symbol: market.symbol,
      valueUsd: loanValue,
    },
    loanHealth,
    market: getMarketPair(market),
    maxLoanAmount,
    utilization,
    validationError,
  }
}

export function getBorrowFlowMetrics(
  flow: Pick<BorrowFlowState, "collateralAmount" | "loanAmount">,
  market: MarketCardData,
  account: ConnectedAccount | null
): BorrowFlowMetrics {
  const quote = createBorrowQuote({ account, flow, market })
  const hasWallet = Boolean(account)
  const isLoanValid =
    !quote.validationError &&
    quote.loan.amount > 0 &&
    quote.collateral.amount > 0

  return {
    borrowingPower: quote.borrowingPower,
    collateralAmount: quote.collateral.amount,
    collateralValue: quote.collateral.valueUsd,
    collateralWalletBalance: quote.collateralWalletBalance,
    hasWallet,
    healthFactor: quote.healthFactor,
    isLoanValid,
    liquidationPrice: quote.liquidationPrice,
    loanAmount: quote.loan.amount,
    loanHealth: quote.loanHealth,
    loanValue: quote.loan.valueUsd,
    maxLoanAmount: quote.maxLoanAmount,
    quote,
    validationError: quote.validationError,
    utilization: quote.utilization,
  }
}
