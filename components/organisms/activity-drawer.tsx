"use client"

import {
  ActivityIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  ExternalLinkIcon,
  GavelIcon,
  HandCoinsIcon,
  Undo2Icon,
} from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
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
import { formatRawAmount } from "@/features/markets"
import type { ShieldedActivity, ShieldedActivityType } from "@/features/notes"
import { getStellarExpertTxUrl } from "@/features/wallet/network"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"

type ActivityDrawerProps = {
  activities: ShieldedActivity[]
  onOpenChange: (open: boolean) => void
  open: boolean
}

type Chip = { label: string; value: ShieldedActivityType | null }

const CHIPS: Chip[] = [
  { label: "All", value: null },
  { label: "Deposit", value: "deposit" },
  { label: "Borrow", value: "borrow" },
  { label: "Withdraw", value: "withdraw" },
  { label: "Repay", value: "repay" },
  { label: "Liquidate", value: "liquidate" },
]

const TYPE_META: Record<
  ShieldedActivityType,
  { icon: typeof ArrowDownToLineIcon; label: string }
> = {
  borrow: { icon: HandCoinsIcon, label: "Borrowed" },
  deposit: { icon: ArrowDownToLineIcon, label: "Deposited" },
  liquidate: { icon: GavelIcon, label: "Liquidated" },
  repay: { icon: Undo2Icon, label: "Repaid" },
  withdraw: { icon: ArrowUpFromLineIcon, label: "Withdrawn" },
}

export function ActivityDrawer({
  activities,
  onOpenChange,
  open,
}: ActivityDrawerProps): React.ReactElement {
  const [type, setType] = React.useState<ShieldedActivityType | null>(null)
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
            Deposit, borrow, withdraw, repay, and liquidation events for this
            wallet — read from the chain, not a local log.
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
            filtered.map((item) => <ActivityCard item={item} key={item.id} />)
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
            : "Deposit, borrow, withdraw, repay, or liquidate with this wallet and it shows up here."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ActivityCard({
  item,
}: {
  item: ShieldedActivity
}): React.ReactElement {
  const meta = TYPE_META[item.type]
  const Icon = meta.icon

  return (
    <div className="flex items-start gap-2.5 rounded-md border bg-background/72 px-3 py-2.5 text-sm">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 opacity-70" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{meta.label}</span>
          {item.amount !== undefined ? (
            <span className="font-mono text-xs text-muted-foreground">
              <PrivateValue>
                {formatRawAmount(item.amount, item.asset)}
              </PrivateValue>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{item.asset}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/72">
            {formatTimestamp(item.timestamp)}
          </span>
          {item.txHash ? (
            <a
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              href={getStellarExpertTxUrl(item.txHash)}
              rel="noreferrer"
              target="_blank"
            >
              View
              <ExternalLinkIcon aria-hidden="true" className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function formatTimestamp(timestamp: number | undefined): string {
  if (timestamp === undefined) return "Unknown time"
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp * 1000))
  } catch {
    return "Unknown time"
  }
}
