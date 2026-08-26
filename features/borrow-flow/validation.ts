import { MIN_COLLATERAL_VALUE, MIN_LOAN_AMOUNT } from "./constants"
import { formatAssetAmount, formatUsd } from "./format"

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
  // Untouched empty input reads as zero — treat that as "no error yet"
  // so a freshly opened drawer doesn't paint every field red before
  // the user has typed anything.
  if (amount <= 0) {
    return null
  }

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
  amount: number,
  symbol: string,
  valueUsd: number,
  borrowingPower: number
): string | null {
  if (amount <= 0) {
    return null
  }

  if (amount < MIN_LOAN_AMOUNT) {
    return `Loan amount must be at least ${formatAssetAmount(
      MIN_LOAN_AMOUNT,
      symbol
    )}.`
  }

  if (valueUsd > borrowingPower) {
    return "Loan amount exceeds current borrowing power."
  }

  return null
}
