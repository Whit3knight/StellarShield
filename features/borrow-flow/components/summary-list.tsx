import { ArrowRightIcon, type LucideIcon } from "lucide-react"
import type * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Card, CardPanel } from "@/components/ui/card"

type SummarySectionProps = {
  children: React.ReactNode
  description?: string
  icon: LucideIcon
  title: string
}

type SummaryRowProps = {
  icon: LucideIcon
  label: string
  multiline?: boolean
  privateValue?: boolean
  value: string
}

type TransferRouteProps = {
  amount: string
  description?: string
  from: string
  icon: LucideIcon
  label: string
  privateFrom?: boolean
  privateTo?: boolean
  to: string
}

export function SummarySection({
  children,
  description,
  icon: Icon,
  title,
}: SummarySectionProps): React.ReactElement {
  return (
    <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
      <CardPanel className="p-0">
        <div className="flex items-start gap-3 border-b px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/56 text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{title}</div>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="divide-y">{children}</div>
      </CardPanel>
    </Card>
  )
}

export function SummaryRow({
  icon: Icon,
  label,
  multiline = false,
  privateValue = false,
  value,
}: SummaryRowProps): React.ReactElement {
  if (multiline) {
    return (
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
        <RowIcon icon={Icon} />
        <div className="min-w-0 space-y-1.5">
          <span className="block text-muted-foreground">{label}</span>
          <Value
            className="block w-full leading-snug font-medium break-words whitespace-normal"
            privateValue={privateValue}
            value={value}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
      <RowIcon icon={Icon} />
      <div className="flex min-w-0 items-center justify-between gap-4">
        <span className="min-w-0 text-muted-foreground">{label}</span>
        <Value
          className="block max-w-[65%] truncate text-right font-medium"
          privateValue={privateValue}
          value={value}
        />
      </div>
    </div>
  )
}

export function TransferRoute({
  amount,
  description,
  from,
  icon: Icon,
  label,
  privateFrom = false,
  privateTo = false,
  to,
}: TransferRouteProps): React.ReactElement {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
      <RowIcon icon={Icon} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div className="text-muted-foreground">{label}</div>
          <div className="font-medium">{amount}</div>
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <Endpoint privateValue={privateFrom} value={from} />
          <ArrowRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <Endpoint privateValue={privateTo} value={to} />
        </div>
        {description ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }): React.ReactElement {
  return (
    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
    </div>
  )
}

function Endpoint({
  privateValue,
  value,
}: {
  privateValue: boolean
  value: string
}): React.ReactElement {
  return (
    <div className="min-w-0 flex-1 truncate rounded-sm bg-background px-2 py-1 text-xs font-medium">
      <Value privateValue={privateValue} value={value} />
    </div>
  )
}

function Value({
  className,
  privateValue = false,
  value,
}: {
  className?: string
  privateValue?: boolean
  value: string
}): React.ReactElement {
  if (privateValue) {
    return <PrivateValue className={className}>{value}</PrivateValue>
  }

  return <span className={className}>{value}</span>
}
