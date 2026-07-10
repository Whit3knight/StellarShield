"use client"

import { ActivityIcon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ACTIVITY_TYPE_LABELS } from "@/features/borrow-flow/activities"
import type {
  BorrowActivity,
  BorrowActivityType,
} from "@/features/borrow-flow/types"
import { useIsMobile } from "@/hooks/use-media-query"

const ALL_VALUE = "all"

type ActivityDrawerProps = {
  activities: BorrowActivity[]
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function ActivityDrawer({
  activities,
  onOpenChange,
  open,
}: ActivityDrawerProps): React.ReactElement {
  const [type, setType] = React.useState<BorrowActivityType | null>(null)
  const isMobile = useIsMobile()

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setType(null)
      onOpenChange(next)
    },
    [onOpenChange]
  )

  // ponytail: inline predicate; extract to features/borrow-flow/activities.ts
  // when a second surface (positions page, history export) needs it.
  const filtered = type
    ? activities.filter((item) => item.type === type)
    : activities

  return (
    <Drawer
      onOpenChange={handleOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <DrawerTitle>Activity</DrawerTitle>
              <DrawerDescription>
                Everything that happened during this borrow session.
              </DrawerDescription>
            </div>
            <Select
              onValueChange={(value: unknown) => {
                setType(
                  value === ALL_VALUE ? null : (value as BorrowActivityType)
                )
              }}
              value={type ?? ALL_VALUE}
            >
              <SelectTrigger className="w-40 shrink-0">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={ALL_VALUE}>All types</SelectItem>
                {(
                  Object.entries(ACTIVITY_TYPE_LABELS) as [
                    BorrowActivityType,
                    string,
                  ][]
                ).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {activities.length === 0 ? (
            <EmptyState filtered={false} />
          ) : filtered.length === 0 ? (
            <EmptyState filtered />
          ) : (
            filtered.map((item) => (
              <ActivityRow item={item} key={item.id} />
            ))
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState({ filtered }: { filtered: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/16 px-4 py-8 text-center text-sm text-muted-foreground">
      <ActivityIcon aria-hidden="true" className="size-6 opacity-60" />
      {filtered ? (
        <span>No activity matches this filter.</span>
      ) : (
        <>
          <span>No activity yet.</span>
          <span className="text-xs">
            Open a market and start a borrow flow to see events appear here.
          </span>
        </>
      )}
    </div>
  )
}

function ActivityRow({ item }: { item: BorrowActivity }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">{item.title}</span>
        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
      </div>
      <span className="text-xs text-muted-foreground">{item.description}</span>
      {item.value ? (
        <span className="font-mono text-xs text-muted-foreground break-all">
          {item.privateValue ? (
            <PrivateValue>{item.value}</PrivateValue>
          ) : (
            item.value
          )}
        </span>
      ) : null}
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/72">
        {formatTimestamp(item.timestamp)}
      </span>
    </div>
  )
}

function statusVariant(
  status: BorrowActivity["status"]
): "default" | "outline" | "destructive" {
  if (status === "failed") return "destructive"
  if (status === "pending") return "outline"
  return "default"
}

function formatTimestamp(timestamp: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp))
  } catch {
    return timestamp
  }
}
