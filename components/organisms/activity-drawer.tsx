"use client"

import { ActivityIcon } from "lucide-react"
import type * as React from "react"

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
import type { BorrowActivity } from "@/features/borrow-flow/types"

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
  return (
    <Drawer onOpenChange={onOpenChange} open={open} position="right">
      <DrawerPopup>
        <DrawerHeader>
          <DrawerTitle>Activity</DrawerTitle>
          <DrawerDescription>
            Everything that happened during this borrow session.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {activities.length === 0 ? (
            <EmptyState />
          ) : (
            activities.map((item) => <ActivityRow item={item} key={item.id} />)
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/16 px-4 py-8 text-center text-sm text-muted-foreground">
      <ActivityIcon aria-hidden="true" className="size-6 opacity-60" />
      <span>No activity yet.</span>
      <span className="text-xs">
        Open a market and start a borrow flow to see events appear here.
      </span>
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
