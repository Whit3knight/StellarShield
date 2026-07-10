"use client"

import { ChevronDownIcon, ChevronRightIcon, LayersIcon } from "lucide-react"
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
import { cn } from "@/lib/utils"
import type { UserPosition } from "@/features/borrow-flow/types"
import type { ChainBorrowReceipt } from "@/features/protocol"
import { useMediaQuery } from "@/hooks/use-media-query"

type PositionsDrawerProps = {
  chainPosition?: ChainBorrowReceipt | null
  onOpenChange: (open: boolean) => void
  open: boolean
  positions: UserPosition[]
}

export function PositionsDrawer({
  chainPosition,
  onOpenChange,
  open,
  positions,
}: PositionsDrawerProps): React.ReactElement {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const isMobile = useMediaQuery("max-lg")

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setExpandedId(null)
      onOpenChange(next)
    },
    [onOpenChange]
  )

  const handleToggle = React.useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id))
  }, [])

  return (
    <Drawer
      onOpenChange={handleOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <DrawerTitle>Positions</DrawerTitle>
          <DrawerDescription className="mt-2">
            Borrow positions opened during this session.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {chainPosition ? <ChainPositionRow receipt={chainPosition} /> : null}
          {positions.length === 0 && !chainPosition ? (
            <EmptyState />
          ) : (
            positions.map((position) => (
              <PositionRow
                expanded={expandedId === position.id}
                key={position.id}
                onToggle={handleToggle}
                position={position}
              />
            ))
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/16 px-4 py-8 text-center text-sm text-muted-foreground">
      <LayersIcon aria-hidden="true" className="size-6 opacity-60" />
      <span>No positions yet.</span>
      <span className="text-xs">
        Complete a borrow flow to open a position and see it here.
      </span>
    </div>
  )
}

function PositionRow({
  expanded,
  onToggle,
  position,
}: {
  expanded: boolean
  onToggle: (id: string) => void
  position: UserPosition
}): React.ReactElement {
  const healthFactor =
    position.healthFactor === null
      ? "N/A"
      : position.healthFactor.toFixed(2)
  const borrowingPowerUsed = `${Math.round(
    position.borrowingPowerUsed * 100
  )}%`
  const primaryBorrow = position.borrowed[0]

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background text-sm transition-colors",
        expanded && "border-border/80 bg-muted/16"
      )}
    >
      <button
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `Collapse position ${position.id}`
            : `Expand position ${position.id}`
        }
        className="flex flex-col gap-1 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => onToggle(position.id)}
        type="button"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{position.market}</span>
          <div className="flex items-center gap-2">
            <Badge variant="default">{position.status}</Badge>
            {expanded ? (
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            ) : (
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {primaryBorrow ? (
            <span>
              Borrowed {primaryBorrow.amount} {primaryBorrow.symbol}
            </span>
          ) : null}
          <span>Health factor {healthFactor}</span>
          <span>Borrow APR {position.borrowApr}</span>
        </div>
      </button>

      {expanded ? (
        <PositionDetails
          borrowingPowerUsed={borrowingPowerUsed}
          healthFactor={healthFactor}
          position={position}
        />
      ) : null}
    </div>
  )
}

function PositionDetails({
  borrowingPowerUsed,
  healthFactor,
  position,
}: {
  borrowingPowerUsed: string
  healthFactor: string
  position: UserPosition
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 border-t bg-background/64 px-3 pt-3 pb-3 text-xs">
      <AssetList label="Supplied" items={position.supplied} />
      <AssetList label="Borrowed" items={position.borrowed} />

      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Health</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2">
          <dt className="text-muted-foreground">Health factor</dt>
          <dd className="text-right font-medium">{healthFactor}</dd>
          <dt className="text-muted-foreground">Borrowing power used</dt>
          <dd className="text-right font-medium">{borrowingPowerUsed}</dd>
          <dt className="text-muted-foreground">Borrow APR</dt>
          <dd className="text-right font-medium">{position.borrowApr}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Timing</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2">
          <dt className="text-muted-foreground">Opened</dt>
          <dd className="text-right font-medium">
            {formatTimestamp(position.openedAt)}
          </dd>
          <dt className="text-muted-foreground">Next payment due</dt>
          <dd className="text-right font-medium">
            {formatTimestamp(position.nextPaymentDue)}
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Receipt</span>
        <div className="rounded-md border bg-background p-2 font-mono break-all">
          <PrivateValue>{position.receiptHash}</PrivateValue>
        </div>
      </section>
    </div>
  )
}

function AssetList({
  items,
  label,
}: {
  items: UserPosition["supplied"]
  label: string
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <span className="font-medium text-muted-foreground">{label}</span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2">
        {items.length === 0 ? (
          <>
            <dt className="text-muted-foreground">—</dt>
            <dd className="text-right">None</dd>
          </>
        ) : (
          items.map((item) => (
            <React.Fragment key={item.symbol}>
              <dt className="text-muted-foreground">{item.symbol}</dt>
              <dd className="text-right font-medium">
                <PrivateValue>{item.amount.toString()}</PrivateValue>
              </dd>
            </React.Fragment>
          ))
        )}
      </dl>
    </section>
  )
}

const STROOPS_PER_UNIT = 10_000_000n

function stroopsToDisplay(amount: bigint): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const whole = abs / STROOPS_PER_UNIT
  const fraction = abs % STROOPS_PER_UNIT
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "")
  const base = fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString()
  return negative ? `-${base}` : base
}

function ChainPositionRow({
  receipt,
}: {
  receipt: ChainBorrowReceipt
}): React.ReactElement {
  const openedAt = new Date(receipt.confirmedAt * 1000).toISOString()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/8 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">On-chain position</span>
        <Badge variant="outline">Testnet</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Borrowed</dt>
        <dd className="text-right font-mono">
          <PrivateValue>
            {`${stroopsToDisplay(receipt.borrowAmount)} ${receipt.borrowSymbol}`}
          </PrivateValue>
        </dd>
        <dt className="text-muted-foreground">Collateral</dt>
        <dd className="text-right font-mono">
          <PrivateValue>
            {`${stroopsToDisplay(receipt.collateralAmount)} ${receipt.collateralSymbol}`}
          </PrivateValue>
        </dd>
        <dt className="text-muted-foreground">Confirmed</dt>
        <dd className="text-right">{formatTimestamp(openedAt)}</dd>
        <dt className="text-muted-foreground">Proof id</dt>
        <dd className="text-right font-mono break-all">
          <PrivateValue>{receipt.proofId}</PrivateValue>
        </dd>
      </dl>
    </div>
  )
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
