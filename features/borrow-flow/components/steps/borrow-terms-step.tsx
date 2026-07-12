import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
import { AmountInput } from "@/components/molecules/amount-input"
import { InputHelpAddon } from "@/components/molecules/input-help-addon"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  deriveMarketMetrics,
  formatPercent,
  getAssetPriceUsd,
  getMarketPair,
  useMarketStats,
  type MarketCardData,
} from "@/features/markets"

import { MIN_COLLATERAL_VALUE, MIN_LOAN_VALUE } from "../../constants"
import type {
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
} from "../../types"
import {
  formatAssetAmount,
  formatPairPrice,
  formatUsd,
} from "../../format"
import {
  getCollateralValidationError,
  getLoanValidationError,
} from "../../validation"

type BorrowTermsStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (field: BorrowField, value: string) => void
}

export function BorrowTermsStep({
  account,
  flow,
  market,
  metrics,
  onFieldChange,
}: BorrowTermsStepProps): React.ReactElement {
  const collateralError = getCollateralValidationError({
    amount: metrics.collateralAmount,
    balance: metrics.collateralWalletBalance,
    hasWallet: Boolean(account),
    symbol: market.collateral,
    valueUsd: metrics.collateralValue,
  })
  const loanError = getLoanValidationError(
    metrics.loanValue,
    metrics.borrowingPower
  )
  const marketPair = getMarketPair(market)
  const { stats } = useMarketStats()
  const derived = deriveMarketMetrics(stats[market.symbol], market.symbol)
  const liveBorrowApr = formatPercent(derived.borrowApr * 100)
  const minimumCollateralAmount =
    MIN_COLLATERAL_VALUE / getAssetPriceUsd(market.collateral)
  const minimumLoanAmount = MIN_LOAN_VALUE / getAssetPriceUsd(market.symbol)
  const liquidationPrice =
    metrics.quote.liquidationPrice === null
      ? "N/A"
      : `${formatUsd(metrics.quote.liquidationPrice)} / ${market.collateral}`

  return (
    <Form className="flex w-full flex-col gap-4">
      <Field>
        <FieldLabel>Market</FieldLabel>
        <InputGroup>
          <InputGroupInput
            aria-label="Selected market"
            readOnly
            type="text"
            value={marketPair}
          />
          <InputHelpAddon>
            The market pair selected for this borrow request.
          </InputHelpAddon>
        </InputGroup>
        <FieldDescription>
          Pair price: {formatPairPrice(market)}
        </FieldDescription>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field invalid={Boolean(collateralError)}>
          <FieldLabel>Collateral amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>{market.collateral}</InputGroupAddon>
            <AmountInput
              aria-invalid={Boolean(collateralError)}
              aria-label="Collateral amount"
              className="*:[input]:ps-0!"
              max={metrics.collateralWalletBalance || undefined}
              min={minimumCollateralAmount}
              onValueChange={(raw) =>
                onFieldChange("collateralAmount", raw)
              }
              value={flow.collateralAmount}
            />
            <InputHelpAddon>
              Enter collateral worth at least {formatUsd(MIN_COLLATERAL_VALUE)}.
            </InputHelpAddon>
          </InputGroup>
          <FieldDescription>
            {account ? (
              <>
                <PrivateValue>
                  {formatAssetAmount(
                    metrics.collateralWalletBalance,
                    market.collateral
                  )}
                </PrivateValue>{" "}
                available
              </>
            ) : (
              "Connect wallet to view available collateral"
            )}
          </FieldDescription>
          {collateralError ? <FieldError>{collateralError}</FieldError> : null}
        </Field>
        <Field invalid={Boolean(loanError)}>
          <FieldLabel>Loan amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>{market.symbol}</InputGroupAddon>
            <AmountInput
              aria-invalid={Boolean(loanError)}
              aria-label="Loan amount"
              className="*:[input]:ps-0!"
              max={metrics.maxLoanAmount}
              min={minimumLoanAmount}
              onValueChange={(raw) => onFieldChange("loanAmount", raw)}
              value={flow.loanAmount}
            />
            <InputHelpAddon>
              Enter at least{" "}
              {formatAssetAmount(minimumLoanAmount, market.symbol)}.
            </InputHelpAddon>
          </InputGroup>
          <FieldDescription>
            Available to borrow:{" "}
            {formatAssetAmount(metrics.maxLoanAmount, market.symbol)}
          </FieldDescription>
          {loanError ? <FieldError>{loanError}</FieldError> : null}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Borrowing power"
          value={formatUsd(metrics.borrowingPower)}
        />
        <MetricTile
          label="Max borrow"
          value={formatAssetAmount(metrics.maxLoanAmount, market.symbol)}
        />
        <MetricTile label="Borrow APR" value={liveBorrowApr} />
        <MetricTile label="Loan health" value={metrics.loanHealth} />
        <MetricTile
          label="Health factor"
          value={
            metrics.healthFactor === null
              ? "N/A"
              : metrics.healthFactor.toFixed(2)
          }
        />
        <MetricTile
          label="Utilization"
          value={`${Math.round(metrics.utilization * 100)}%`}
        />
        <MetricTile label="Liquidation price" value={liquidationPrice} />
        <MetricTile
          label="Estimated fee"
          value={formatAssetAmount(
            metrics.quote.estimatedFee.amount,
            metrics.quote.estimatedFee.symbol
          )}
        />
      </div>
    </Form>
  )
}
