import { MIN_COLLATERAL_VALUE, MIN_LOAN_VALUE } from "./constants"
import { formatUsd } from "./format"

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
