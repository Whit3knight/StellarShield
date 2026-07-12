"use client"

import * as React from "react"
import { NumericFormat } from "react-number-format"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Thousands-separated decimal amount input built on
 * `react-number-format`. Emits the raw unformatted string via
 * `onValueChange` so callers can persist unambiguous values (e.g.
 * "1234.5" instead of "1,234.5") while the visible field shows
 * "1,234.5".
 */
export type AmountInputProps = {
  "aria-invalid"?: boolean
  "aria-label"?: string
  className?: string
  decimalScale?: number
  disabled?: boolean
  id?: string
  max?: number
  min?: number
  onValueChange: (raw: string) => void
  placeholder?: string
  value: string
}

export function AmountInput({
  className,
  decimalScale = 6,
  onValueChange,
  value,
  max,
  min,
  ...rest
}: AmountInputProps): React.ReactElement {
  return (
    <NumericFormat
      allowNegative={false}
      className={cn(className)}
      customInput={Input as unknown as React.ComponentType<Record<string, unknown>>}
      decimalScale={decimalScale}
      inputMode="decimal"
      isAllowed={(values) => {
        const { floatValue } = values
        if (floatValue === undefined) return true
        if (max !== undefined && floatValue > max) return false
        if (min !== undefined && floatValue < 0) return false
        return true
      }}
      onValueChange={(values) => {
        onValueChange(values.value)
      }}
      thousandSeparator=","
      unstyled
      value={value}
      {...rest}
    />
  )
}
