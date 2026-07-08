import { DollarSignIcon } from "lucide-react"
import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { MetricTile } from "@/components/atoms/metric-tile"
import { PrivateValue } from "@/components/atoms/private-value"
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
  MAX_COLLATERAL_VALUE,
  MIN_COLLATERAL_VALUE,
  MIN_LOAN_VALUE,
  MOCK_ACCOUNT_BALANCE,
} from "../../constants"
import type {
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
} from "../../types"
import {
  formatUsd,
  getCollateralValidationError,
  getLoanValidationError,
} from "../../utils"

type BorrowTermsStepProps = {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (field: BorrowField, value: string) => void
}

export function BorrowTermsStep({
  flow,
  market,
  metrics,
  onFieldChange,
}: BorrowTermsStepProps): React.ReactElement {
  const collateralError = getCollateralValidationError(metrics.collateralValue)
  const loanError = getLoanValidationError(
    metrics.loanValue,
    metrics.borrowingPower
  )
  const marketPair = getMarketPair(market)

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
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field invalid={Boolean(collateralError)}>
          <FieldLabel>Collateral value</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <DollarSignIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={Boolean(collateralError)}
              aria-label="Collateral value"
              className="*:[input]:ps-0!"
              inputMode="decimal"
              max={MAX_COLLATERAL_VALUE}
              min={MIN_COLLATERAL_VALUE}
              onChange={(event) => {
                onFieldChange("collateralAmount", event.currentTarget.value)
              }}
              step="0.01"
              type="number"
              value={flow.collateralAmount}
            />
            <InputHelpAddon>
              Enter collateral value from {formatUsd(MIN_COLLATERAL_VALUE)} to{" "}
              {formatUsd(MAX_COLLATERAL_VALUE)}.
            </InputHelpAddon>
          </InputGroup>
          <FieldDescription>
            <PrivateValue>{MOCK_ACCOUNT_BALANCE}</PrivateValue> available
          </FieldDescription>
          {collateralError ? <FieldError>{collateralError}</FieldError> : null}
        </Field>
        <Field invalid={Boolean(loanError)}>
          <FieldLabel>Loan amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <DollarSignIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={Boolean(loanError)}
              aria-label="Loan amount"
              className="*:[input]:ps-0!"
              inputMode="decimal"
              max={metrics.borrowingPower}
              min={MIN_LOAN_VALUE}
              onChange={(event) => {
                onFieldChange("loanAmount", event.currentTarget.value)
              }}
              step="0.01"
              type="number"
              value={flow.loanAmount}
            />
            <InputHelpAddon>
              Enter loan amount from {formatUsd(MIN_LOAN_VALUE)} to{" "}
              {formatUsd(metrics.borrowingPower)}.
            </InputHelpAddon>
          </InputGroup>
          <FieldDescription>
            Available to borrow: {formatUsd(metrics.borrowingPower)}
          </FieldDescription>
          {loanError ? <FieldError>{loanError}</FieldError> : null}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Borrowing power"
          value={formatUsd(metrics.borrowingPower)}
        />
        <MetricTile label="Borrow APR" value={market.borrowApr} />
        <MetricTile label="Loan health" value={metrics.loanHealth} />
        <MetricTile
          label="Utilization"
          value={`${Math.round(metrics.utilization * 100)}%`}
        />
      </div>
    </Form>
  )
}
