"use client"

import { LayersIcon } from "lucide-react"
import * as React from "react"

import { ExternalLink } from "@/components/atoms/external-link"
import { PrivateValue } from "@/components/atoms/private-value"
import {
  PositionCard,
  type PositionCardField,
} from "@/components/molecules/position-card"
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { formatAssetAmount, formatUsd } from "@/features/borrow-flow/format"
import type { UserPosition } from "@/features/borrow-flow/types"
import type { AssetAmount } from "@/features/shared/asset-amount"
import type { ChainBorrowReceipt } from "@/features/protocol"
import {
  getStellarExpertAccountUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"
import { useMediaQuery } from "@/hooks/use-media-query"

type PositionsDrawerProps = {
  chainLoading?: boolean
  chainPositions?: ChainBorrowReceipt[]
  onOpenChange: (open: boolean) => void
  open: boolean
  positions: UserPosition[]
}

type PositionGroup = {
  borrowed: AggregateAsset | null
  healthFactor: number | null
  latestOpenedAt: string
  market: string
  positions: UserPosition[]
  supplied: AggregateAsset | null
}

type AggregateAsset = {
  amount: number
  symbol: string
  valueUsd: number
}

export function PositionsDrawer({
  chainLoading = false,
  chainPositions = EMPTY_CHAIN_LIST,
  onOpenChange,
  open,
  positions,
}: PositionsDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const groups = React.useMemo(() => groupByMarket(positions), [positions])
  const chainByMarket = React.useMemo(() => {
    const byMarket = new Map<string, ChainBorrowReceipt[]>()
    for (const receipt of chainPositions) {
      const pair = `${receipt.borrowSymbol}/${receipt.collateralSymbol}`
      const list = byMarket.get(pair) ?? []
      list.push(receipt)
      byMarket.set(pair, list)
    }
    return byMarket
  }, [chainPositions])

  const orphanChainGroups = React.useMemo(() => {
    const matched = new Set(groups.map((g) => g.market))
    return Array.from(chainByMarket.entries())
      .filter(([market]) => !matched.has(market))
      .map(([, receipts]) => receipts)
  }, [chainByMarket, groups])

  const nothingToShow =
    groups.length === 0 &&
    chainPositions.length === 0 &&
    !chainLoading

  return (
    <Drawer
      onOpenChange={onOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <DrawerTitle>Positions</DrawerTitle>
          <DrawerDescription className="mt-2">
            Aggregated borrow positions grouped by market pair.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {nothingToShow ? <EmptyState /> : null}
          {groups.map((group) => (
            <GroupCard
              chainReceipts={chainByMarket.get(group.market) ?? EMPTY_CHAIN_LIST}
              group={group}
              key={group.market}
            />
          ))}
          {orphanChainGroups.map((receipts) => (
            <GroupCard
              chainReceipts={receipts}
              group={null}
              key={receipts[0].proofId}
            />
          ))}
          {chainLoading && groups.length === 0 && chainPositions.length === 0 ? (
            <GroupCard chainReceipts={EMPTY_CHAIN_LIST} group={null} />
          ) : null}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

const EMPTY_CHAIN_LIST: ChainBorrowReceipt[] = []

function EmptyState(): React.ReactElement {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon />
        </EmptyMedia>
        <EmptyTitle>No positions yet</EmptyTitle>
        <EmptyDescription>
          Complete a borrow flow to open a position and see it here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function GroupCard({
  chainReceipts,
  group,
}: {
  chainReceipts: ChainBorrowReceipt[]
  group: PositionGroup | null
}): React.ReactElement {
  const latestChain = chainReceipts[0] ?? null
  const healthFactor =
    group?.healthFactor == null ? "N/A" : group.healthFactor.toFixed(2)
  const subtitle =
    group?.market ??
    (latestChain
      ? `${latestChain.borrowSymbol}/${latestChain.collateralSymbol}`
      : undefined)

  const fields: PositionCardField[] = []

  if (latestChain) {
    const openedAt = new Date(latestChain.confirmedAt * 1000).toISOString()
    fields.push(
      { label: "On-chain confirmed", value: formatTimestamp(openedAt) },
      {
        label: "Proof id",
        value: (
          <PrivateValue className="truncate font-mono">
            {shortHash(latestChain.proofId)}
          </PrivateValue>
        ),
      },
      {
        label: "Account",
        value: (
          <ExternalLink
            className="justify-end font-mono"
            href={getStellarExpertAccountUrl(latestChain.account)}
          >
            <PrivateValue className="truncate">
              {shortHash(latestChain.account)}
            </PrivateValue>
          </ExternalLink>
        ),
      }
    )
  }

  fields.push(
    {
      label: "Supplied",
      value: group?.supplied ? (
        formatAggregate(group.supplied)
      ) : group ? (
        "N/A"
      ) : (
        <Skeleton className="ml-auto h-3.5 w-24" />
      ),
    },
    {
      label: "Borrowed",
      value: group?.borrowed ? (
        formatAggregate(group.borrowed)
      ) : group ? (
        "N/A"
      ) : (
        <Skeleton className="ml-auto h-3.5 w-24" />
      ),
    },
    {
      label: "Health factor (min)",
      value: group ? healthFactor : <Skeleton className="ml-auto h-3.5 w-12" />,
    }
  )

  const chainCount = chainReceipts.length
  const badge = (
    <div className="flex items-center gap-1">
      <Badge variant="success">Open</Badge>
      {chainCount > 0 ? (
        <Badge variant="outline">
          Testnet{chainCount > 1 ? ` · ${chainCount}` : ""}
        </Badge>
      ) : null}
    </div>
  )

  return (
    <PositionCard
      badge={badge}
      fields={fields}
      footer={
        group ? <ReceiptsAccordion positions={group.positions} /> : null
      }
      subtitle={subtitle}
      title="Position open"
    />
  )
}

function ReceiptsAccordion({
  positions,
}: {
  positions: UserPosition[]
}): React.ReactElement {
  const sorted = [...positions].sort((a, b) =>
    b.openedAt.localeCompare(a.openedAt)
  )
  return (
    <Accordion>
      <AccordionItem className="border-b-0 border-t" value="receipts">
        <AccordionTrigger className="gap-2 pt-2 pb-4 text-sm font-normal text-muted-foreground">
          <span>Positions</span>
          <span className="ml-auto font-medium text-foreground">
            {positions.length}
          </span>
        </AccordionTrigger>
        <AccordionPanel className="flex flex-col gap-1.5 pb-1 text-xs">
          {sorted.map((position) => (
            <ReceiptRow key={position.id} position={position} />
          ))}
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}

function ReceiptRow({
  position,
}: {
  position: UserPosition
}): React.ReactElement {
  const supplied = position.supplied[0]
  const borrowed = position.borrowed[0]
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background/64 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <ExternalLink
          className="font-mono text-foreground"
          href={getStellarExpertTxUrl(position.receiptHash)}
        >
          <PrivateValue className="truncate">
            {shortHash(position.receiptHash)}
          </PrivateValue>
        </ExternalLink>
        <span className="text-muted-foreground">
          {formatTimestamp(position.openedAt)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-muted-foreground">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide">Supplied</span>
          <span className="text-foreground">
            {supplied
              ? `${formatAssetAmount(supplied.amount, supplied.symbol)} (${formatUsd(supplied.valueUsd)})`
              : "N/A"}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="text-[10px] uppercase tracking-wide">Borrowed</span>
          <span className="text-foreground">
            {borrowed
              ? `${formatAssetAmount(borrowed.amount, borrowed.symbol)} (${formatUsd(borrowed.valueUsd)})`
              : "N/A"}
          </span>
        </div>
      </div>
    </div>
  )
}

function groupByMarket(positions: UserPosition[]): PositionGroup[] {
  const buckets = new Map<string, UserPosition[]>()
  for (const position of positions) {
    const list = buckets.get(position.market) ?? []
    list.push(position)
    buckets.set(position.market, list)
  }

  return Array.from(buckets.entries()).map(([market, list]) => ({
    borrowed: aggregateFirst(list.map((p) => p.borrowed[0])),
    healthFactor: minHealthFactor(list),
    latestOpenedAt:
      list.map((p) => p.openedAt).sort().at(-1) ?? new Date(0).toISOString(),
    market,
    positions: list,
    supplied: aggregateFirst(list.map((p) => p.supplied[0])),
  }))
}

function aggregateFirst(
  items: (AssetAmount | undefined)[]
): AggregateAsset | null {
  const filtered = items.filter((item): item is AssetAmount => Boolean(item))
  if (filtered.length === 0) return null

  const symbol = filtered[0].symbol
  const homogeneous = filtered.every((item) => item.symbol === symbol)
  if (!homogeneous) return null

  return filtered.reduce<AggregateAsset>(
    (acc, item) => ({
      amount: acc.amount + item.amount,
      symbol,
      valueUsd: acc.valueUsd + item.valueUsd,
    }),
    { amount: 0, symbol, valueUsd: 0 }
  )
}

function minHealthFactor(positions: UserPosition[]): number | null {
  const numbers = positions
    .map((p) => p.healthFactor)
    .filter((n): n is number => n !== null)
  if (numbers.length === 0) return null
  return Math.min(...numbers)
}

function formatAggregate(asset: AggregateAsset): string {
  return `${formatAssetAmount(asset.amount, asset.symbol)} (${formatUsd(asset.valueUsd)})`
}

function shortHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
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
