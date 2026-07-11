import * as React from "react"

import { cn } from "@/lib/utils"

export type PositionCardField = {
  label: string
  value: React.ReactNode
}

type PositionCardProps = {
  accent?: boolean
  badge?: React.ReactNode
  fields: PositionCardField[]
  footer?: React.ReactNode
  subtitle?: string
  title: string
}

export function PositionCard({
  accent = false,
  badge,
  fields,
  footer,
  subtitle,
  title,
}: PositionCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 text-sm",
        accent ? "border-primary/40 bg-primary/8" : "bg-background/72"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm text-foreground">{title}</h3>
          {subtitle ? (
            <p className="mt-1 text-muted-foreground text-xs">{subtitle}</p>
          ) : null}
        </div>
        {badge}
      </div>
      <dl className="grid gap-2 text-sm">
        {fields.map((field) => (
          <div
            className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
            key={field.label}
          >
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="max-w-[60%] text-right font-medium break-words">
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer}
    </section>
  )
}
