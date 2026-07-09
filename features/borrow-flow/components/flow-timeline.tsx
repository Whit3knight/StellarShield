import { ArrowRightIcon, InfoIcon, type LucideIcon } from "lucide-react"
import type * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type TimelineItemStatus = "active" | "done" | "failed" | "pending"

type TimelineMeta = {
  info?: string
  label: string
  privateValue?: boolean
  value: string
  wide?: boolean
}

type TimelineSectionProps = {
  children: React.ReactNode
}

type TimelineItemProps = {
  action?: React.ReactNode
  amount?: string
  from?: string
  icon: LucideIcon
  info?: string
  isLast?: boolean
  label: string
  meta?: TimelineMeta[]
  privateAmount?: boolean
  privateFrom?: boolean
  privateTo?: boolean
  status?: TimelineItemStatus
  to?: string
}

const timelineStatusClass: Record<TimelineItemStatus, string> = {
  active: "border-primary/40 bg-primary/10 text-primary ring-4 ring-primary/10",
  done: "border-success/32 bg-success/12 text-success",
  failed: "border-destructive/32 bg-destructive/10 text-destructive",
  pending: "border-border bg-background text-muted-foreground",
}

export function TimelineSection({
  children,
}: TimelineSectionProps): React.ReactElement {
  return <div className="py-1">{children}</div>
}

export function TimelineItem({
  action,
  amount,
  from,
  icon: Icon,
  info,
  isLast = false,
  label,
  meta = [],
  privateAmount = false,
  privateFrom = false,
  privateTo = false,
  status = "pending",
  to,
}: TimelineItemProps): React.ReactElement {
  const hasRoute = Boolean(from && to)

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 py-3.5 text-sm">
      <div className="relative flex justify-center">
        {isLast ? null : (
          <span
            aria-hidden="true"
            className="absolute top-10 bottom-[-0.875rem] w-px bg-border"
          />
        )}
        <div
          className={cn(
            "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
            timelineStatusClass[status]
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 pt-1">
            <LabelWithInfo info={info} label={label} />
          </div>

          {amount || action ? (
            <div className="flex max-w-[64%] shrink-0 items-center gap-1">
              {amount ? (
                <Value
                  className="text-right font-medium leading-snug break-words whitespace-normal"
                  privateValue={privateAmount}
                  value={amount}
                />
              ) : null}
              {action}
            </div>
          ) : null}
        </div>

        {hasRoute ? (
          <RouteLine
            from={from ?? ""}
            privateFrom={privateFrom}
            privateTo={privateTo}
            to={to ?? ""}
          />
        ) : null}

        {meta.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {meta.map((item) => (
              <TimelineMetaItem item={item} key={item.label} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TimelineMetaItem({
  item,
}: {
  item: TimelineMeta
}): React.ReactElement {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-background/72 px-3 py-2.5",
        item.wide && "sm:col-span-2"
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <LabelWithInfo info={item.info} label={item.label} />
      </div>
      <Value
        className="mt-1 block min-w-0 text-sm font-medium leading-snug break-words whitespace-normal"
        privateValue={item.privateValue}
        value={item.value}
      />
    </div>
  )
}

function RouteLine({
  from,
  privateFrom,
  privateTo,
  to,
}: {
  from: string
  privateFrom: boolean
  privateTo: boolean
  to: string
}): React.ReactElement {
  return (
    <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-2 text-muted-foreground text-xs">
      <Endpoint privateValue={privateFrom} value={from} />
      <ArrowRightIcon
        aria-hidden="true"
        className="mx-auto size-3.5 shrink-0"
      />
      <Endpoint privateValue={privateTo} value={to} />
    </div>
  )
}

function LabelWithInfo({
  info,
  label,
}: {
  info?: string
  label: string
}): React.ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      <span className="min-w-0 text-xs leading-tight">{label}</span>
      <InfoHint label={`${label} details`} text={info} />
    </span>
  )
}

function InfoHint({
  label,
  text,
}: {
  label: string
  text?: string
}): React.ReactElement | null {
  if (!text) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="size-5 rounded-sm text-muted-foreground hover:text-foreground"
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        <InfoIcon aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup className="max-w-56" side="top">
        {text}
      </TooltipPopup>
    </Tooltip>
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
    <Value
      className="block min-w-0 truncate rounded-md border bg-muted/16 px-3 py-1.5 text-center font-medium text-foreground"
      privateValue={privateValue}
      value={value}
    />
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
