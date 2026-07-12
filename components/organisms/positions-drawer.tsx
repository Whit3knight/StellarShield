"use client"

import { LayersIcon } from "lucide-react"
import type * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { PositionCard } from "@/components/molecules/position-card"
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
import { useAssetPrices } from "@/features/markets"
import { useNotes, type ShieldedNote } from "@/features/notes"
import { useRiskParams } from "@/features/protocol/risk-params"
import { useMediaQuery } from "@/hooks/use-media-query"

type PositionsDrawerProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

/**
 * Reads open loan notes from the shielded scanner (same source as the
 * shielded drawer) and groups them by asset. No wallet address is
 * queried or shown — every field on this drawer derives from local
 * decrypted memos.
 */
export function PositionsDrawer({
  onOpenChange,
  open,
}: PositionsDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const notes = useNotes()
  const prices = useAssetPrices()
  const risk = useRiskParams()
  const loans = notes.filter((note) => note.tree === "loan")
  const groups = groupByAsset(loans)

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
            Open shielded loans grouped by borrow asset. Manage from the
            shielded pool drawer.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {groups.length === 0 ? <EmptyState /> : null}
          {groups.map((group) => (
            <AssetGroupCard
              group={group}
              key={group.asset}
              liquidationThresholdBps={risk.liquidationThresholdBps}
              prices={prices}
            />
          ))}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

type AssetGroup = {
  asset: string
  loans: ShieldedNote[]
}

function groupByAsset(loans: ShieldedNote[]): AssetGroup[] {
  const byAsset = new Map<string, ShieldedNote[]>()
  for (const loan of loans) {
    const list = byAsset.get(loan.asset) ?? []
    list.push(loan)
    byAsset.set(loan.asset, list)
  }
  return Array.from(byAsset.entries())
    .map(([asset, list]) => ({
      asset,
      loans: list.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)),
    }))
    .sort((a, b) => a.asset.localeCompare(b.asset))
}

function EmptyState(): React.ReactElement {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon />
        </EmptyMedia>
        <EmptyTitle>No open positions</EmptyTitle>
        <EmptyDescription>
          Borrow from the shielded pool drawer to open a position.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function AssetGroupCard({
  group,
  liquidationThresholdBps,
  prices,
}: {
  group: AssetGroup
  liquidationThresholdBps: number
  prices: Record<"XLM" | "USDC" | "EURC", number>
}): React.ReactElement {
  const latestOpenedAt = group.loans.reduce(
    (max, loan) => Math.max(max, loan.openedAt ?? 0),
    0
  )
  const underwaterCount = group.loans.reduce((count, loan) => {
    if (!loan.bond) return count
    return isUnderwater({
      bond: loan.bond,
      loanAmount: loan.amount,
      loanAsset: loan.asset,
      prices,
      thresholdBps: liquidationThresholdBps,
    })
      ? count + 1
      : count
  }, 0)

  const badge = (
    <div className="flex items-center gap-1">
      <Badge variant={underwaterCount > 0 ? "destructive" : "success"}>
        {underwaterCount > 0 ? `${underwaterCount} at risk` : "Healthy"}
      </Badge>
      <Badge variant="outline">
        {group.loans.length} loan{group.loans.length === 1 ? "" : "s"}
      </Badge>
    </div>
  )

  return (
    <PositionCard
      badge={badge}
      fields={[
        {
          label: "Amounts",
          value: (
            <PrivateValue className="italic text-muted-foreground">
              Hidden (private note)
            </PrivateValue>
          ),
        },
        {
          label: "Latest opened",
          value: latestOpenedAt
            ? formatOpenedAt(latestOpenedAt)
            : "—",
        },
      ]}
      subtitle={group.asset}
      title="Loan positions"
    />
  )
}

function formatOpenedAt(seconds: number): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(seconds * 1000))
  } catch {
    return "—"
  }
}

// Mirror of `shielded-drawer`'s isUnderwater — kept local so the two
// surfaces don't couple through a shared helper the drawer doesn't
// need. Keep the two definitions in lockstep when tuning the
// liquidation heuristic.
function isUnderwater({
  bond,
  loanAmount,
  loanAsset,
  prices,
  thresholdBps,
}: {
  bond: NonNullable<ShieldedNote["bond"]>
  loanAmount: bigint
  loanAsset: "XLM" | "USDC" | "EURC"
  prices: Record<"XLM" | "USDC" | "EURC", number>
  thresholdBps: number
}): boolean {
  const priceAsset = bond.collateralAsset ?? loanAsset
  const priceNow = prices[priceAsset]
  if (!priceNow || priceNow <= 0) return false
  const currentScaled = BigInt(Math.floor(priceNow * 1_000_000))
  const borrowScaled = bond.borrowPrice
  if (borrowScaled <= 0n || loanAmount <= 0n) return false
  const lhs = loanAmount * BigInt(thresholdBps) * borrowScaled
  const rhs = bond.collateralValue * currentScaled * 10_000n
  return lhs > rhs
}
