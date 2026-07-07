import type * as React from "react"

import { getMarketPair, type MarketCardData } from "@/app/_constants/dashboard"
import { MetricTile } from "@/components/atoms/metric-tile"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"

import { MOCK_ACCOUNT_BALANCE } from "../../constants"
import type {
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
} from "../../types"
import { formatUsd } from "../../utils"

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
  return (
    <Form className="flex w-full flex-col gap-4">
      <Field>
        <FieldLabel>Market</FieldLabel>
        <Input defaultValue={getMarketPair(market)} readOnly type="text" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Collateral value</FieldLabel>
          <Input
            inputMode="decimal"
            onChange={(event) => {
              onFieldChange("collateralAmount", event.currentTarget.value)
            }}
            type="text"
            value={flow.collateralAmount}
          />
          <FieldDescription>{MOCK_ACCOUNT_BALANCE} available</FieldDescription>
        </Field>
        <Field invalid={!metrics.isLoanValid}>
          <FieldLabel>Loan amount</FieldLabel>
          <Input
            aria-invalid={!metrics.isLoanValid}
            inputMode="decimal"
            onChange={(event) => {
              onFieldChange("loanAmount", event.currentTarget.value)
            }}
            type="text"
            value={flow.loanAmount}
          />
          <FieldDescription>
            Available to borrow: {formatUsd(metrics.borrowingPower)}
          </FieldDescription>
          {!metrics.isLoanValid ? (
            <FieldError>
              Loan amount exceeds current borrowing power.
            </FieldError>
          ) : null}
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
