"use client"

import { ActivityIcon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type {
  BorrowActivity,
  BorrowActivityType,
} from "@/features/borrow-flow/types"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"

type ActivityDrawerProps = {
  activities: BorrowActivity[]
  onOpenChange: (open: boolean) => void
  open: boolean
}

type Chip = { label: string; value: BorrowActivityType | null }

const CHIPS: Chip[] = [
  { label: "All", value: null },
  { label: "Intent", value: "borrow_intent_prepared" },
  { label: "Proof", value: "proof_generated" },
  { label: "Confirmed", value: "transaction_confirmed" },
  { label: "Submitted", value: "transaction_submitted" },
  { label: "Wallet", value: "wallet_connected" },
]

export function ActivityDrawer({
  activities,
  onOpenChange,
  open,
}: ActivityDrawerProps): React.ReactElement {
  const [type, setType] = React.useState<BorrowActivityType | null>(null)
  const isMobile = useMediaQuery("max-lg")

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setType(null)
      onOpenChange(next)
    },
    [onOpenChange]
  )

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
          <DrawerTitle>Activity</DrawerTitle>
          <DrawerDescription className="mt-2">
            Everything that happened during this borrow session.
          </DrawerDescription>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => {
              const active = type === chip.value
              return (
                <Button
                  className={cn(
                    "h-7 rounded-full px-3 text-xs",
                    active && "border-primary/50"
                  )}
                  key={chip.label}
                  onClick={() => setType(chip.value)}
                  size="sm"
                  type="button"
                  variant={active ? "secondary" : "outline"}
                >
                  {chip.label}
                </Button>
              )
            })}
          </div>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {activities.length === 0 ? (
            <EmptyState filtered={false} />
          ) : filtered.length === 0 ? (
            <EmptyState filtered />
          ) : (
            filtered.map((item) => (
              <ActivityCard item={item} key={item.id} />
            ))
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState({ filtered }: { filtered: boolean }): React.ReactElement {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ActivityIcon />
        </EmptyMedia>
        <EmptyTitle>
          {filtered ? "No matching activity" : "No activity yet"}
        </EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Nothing matches this filter. Try another chip or reset to All."
            : "Open a market and start a borrow flow to see events appear here."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ActivityCard({ item }: { item: BorrowActivity }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background/72 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">{item.title}</span>
        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
      </div>
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
): "success" | "outline" | "destructive" {
  if (status === "failed") return "destructive"
  if (status === "pending") return "outline"
  return "success"
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
