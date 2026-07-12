"use client"

import { LayersIcon, Loader2Icon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { PositionCard } from "@/components/molecules/position-card"
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
import { useAssetPrices } from "@/features/markets"
import { useNotes, type ShieldedAsset, type ShieldedNote } from "@/features/notes"
import { useRiskParams } from "@/features/protocol/risk-params"
import {
  useLiquidate,
  useRepay,
  useShieldedPoolContext,
  useWithdraw,
} from "@/features/shielded-pool"
import { useMediaQuery } from "@/hooks/use-media-query"

type PositionsDrawerProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

/**
 * Positions drawer groups all shielded notes by asset so the user
 * sees a per-asset summary card first, then a nested list of the
 * individual notes with per-note actions (Withdraw / Claim / Repay /
 * Liquidate). Reads directly from `useNotes()`; no wallet address is
 * queried or shown.
 */
export function PositionsDrawer({
  onOpenChange,
  open,
}: PositionsDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const { account, identity, isScanning } = useShieldedPoolContext()
  const notes = useNotes()
  const prices = useAssetPrices()
  const risk = useRiskParams()

  const {
    activeNoteIndex: withdrawingIndex,
    status: withdrawStatus,
    withdraw,
  } = useWithdraw(account)
  const {
    activeLoanIndex: repayingIndex,
    status: repayStatus,
    repay,
  } = useRepay(account)
  const {
    activeLoanIndex: liquidatingIndex,
    status: liquidateStatus,
    liquidate,
  } = useLiquidate(account, identity)

  const showWithdrawBusy =
    withdrawStatus !== "idle" && withdrawStatus !== "success"
  const showRepayBusy = repayStatus !== "idle" && repayStatus !== "success"
  const showLiquidateBusy =
    liquidateStatus !== "idle" && liquidateStatus !== "success"
  const busyWithdrawIndex = showWithdrawBusy ? withdrawingIndex : null
  const busyRepayIndex = showRepayBusy ? repayingIndex : null
  const busyLiquidateIndex = showLiquidateBusy ? liquidatingIndex : null

  const groups = React.useMemo(
    () => groupByAsset(notes),
    [notes]
  )

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
            Shielded notes grouped by asset. Amount + wallet stay
            local; everything renders from decrypted memos.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {!account ? (
            <EmptyState
              description="Connect a wallet to derive the shielded identity that unlocks your notes."
              title="Wallet not connected"
            />
          ) : notes.length === 0 && isScanning ? (
            <EmptyState
              description="Replaying deposit, loan, and repay events + decrypting memos."
              title="Scanning"
            />
          ) : notes.length === 0 ? (
            <EmptyState
              description="Add collateral from a market card to open your first shielded position."
              title="No notes yet"
            />
          ) : (
            groups.map((group) => (
              <AssetGroupCard
                busyLiquidateIndex={busyLiquidateIndex}
                busyRepayIndex={busyRepayIndex}
                busyWithdrawIndex={busyWithdrawIndex}
                group={group}
                key={group.asset}
                liquidationThresholdBps={risk.liquidationThresholdBps}
                notes={notes}
                onLiquidate={(loan) => void liquidate(loan)}
                onRepay={(loan, deposit) => void repay(loan, deposit)}
                onWithdraw={(note) => void withdraw(note)}
                prices={prices}
              />
            ))
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

type AssetGroup = {
  asset: ShieldedAsset
  deposits: ShieldedNote[]
  loans: ShieldedNote[]
}

function groupByAsset(notes: ShieldedNote[]): AssetGroup[] {
  const byAsset = new Map<ShieldedAsset, AssetGroup>()
  for (const note of notes) {
    const bucket =
      byAsset.get(note.asset) ??
      ({
        asset: note.asset,
        deposits: [],
        loans: [],
      } satisfies AssetGroup)
    if (note.tree === "loan") bucket.loans.push(note)
    else bucket.deposits.push(note)
    byAsset.set(note.asset, bucket)
  }
  return Array.from(byAsset.values())
    .map((group) => ({
      ...group,
      loans: group.loans.sort(
        (a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)
      ),
      deposits: group.deposits.sort((a, b) => b.index - a.index),
    }))
    .sort((a, b) => a.asset.localeCompare(b.asset))
}

function EmptyState({
  description,
  title,
}: {
  description: string
  title: string
}): React.ReactElement {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function AssetGroupCard({
  busyLiquidateIndex,
  busyRepayIndex,
  busyWithdrawIndex,
  group,
  liquidationThresholdBps,
  notes,
  onLiquidate,
  onRepay,
  onWithdraw,
  prices,
}: {
  busyLiquidateIndex: number | null
  busyRepayIndex: number | null
  busyWithdrawIndex: number | null
  group: AssetGroup
  liquidationThresholdBps: number
  notes: ShieldedNote[]
  onLiquidate: (loan: ShieldedNote) => void
  onRepay: (loan: ShieldedNote, deposit: ShieldedNote) => void
  onWithdraw: (note: ShieldedNote) => void
  prices: Record<ShieldedAsset, number>
}): React.ReactElement {
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
  const latestOpenedAt = group.loans.reduce(
    (max, loan) => Math.max(max, loan.openedAt ?? 0),
    0
  )

  const badge = (
    <div className="flex items-center gap-1">
      {group.loans.length > 0 ? (
        <Badge variant={underwaterCount > 0 ? "destructive" : "success"}>
          {underwaterCount > 0
            ? `${underwaterCount} at risk`
            : "Healthy"}
        </Badge>
      ) : null}
      {group.deposits.length > 0 ? (
        <Badge variant="outline">
          {group.deposits.length} deposit
          {group.deposits.length === 1 ? "" : "s"}
        </Badge>
      ) : null}
      {group.loans.length > 0 ? (
        <Badge variant="outline">
          {group.loans.length} loan{group.loans.length === 1 ? "" : "s"}
        </Badge>
      ) : null}
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
          value: latestOpenedAt ? formatOpenedAt(latestOpenedAt) : "—",
        },
      ]}
      footer={
        <NoteList
          busyLiquidateIndex={busyLiquidateIndex}
          busyRepayIndex={busyRepayIndex}
          busyWithdrawIndex={busyWithdrawIndex}
          liquidationThresholdBps={liquidationThresholdBps}
          notes={notes}
          onLiquidate={onLiquidate}
          onRepay={onRepay}
          onWithdraw={onWithdraw}
          prices={prices}
          rows={[...group.deposits, ...group.loans]}
        />
      }
      subtitle={group.asset}
      title={group.loans.length > 0 ? "Loan positions" : "Shielded deposits"}
    />
  )
}

function NoteList({
  busyLiquidateIndex,
  busyRepayIndex,
  busyWithdrawIndex,
  liquidationThresholdBps,
  notes,
  onLiquidate,
  onRepay,
  onWithdraw,
  prices,
  rows,
}: {
  busyLiquidateIndex: number | null
  busyRepayIndex: number | null
  busyWithdrawIndex: number | null
  liquidationThresholdBps: number
  notes: ShieldedNote[]
  onLiquidate: (loan: ShieldedNote) => void
  onRepay: (loan: ShieldedNote, deposit: ShieldedNote) => void
  onWithdraw: (note: ShieldedNote) => void
  prices: Record<ShieldedAsset, number>
  rows: ShieldedNote[]
}): React.ReactElement {
  return (
    <div className="border-t pt-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Notes
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {rows.map((note) => {
          const isWithdrawBusy = busyWithdrawIndex === note.index
          const isRepayBusy = busyRepayIndex === note.index
          const isLiquidateBusy = busyLiquidateIndex === note.index
          const anyBusy =
            busyWithdrawIndex !== null ||
            busyRepayIndex !== null ||
            busyLiquidateIndex !== null
          const repaySource =
            note.tree === "loan" ? pickRepaySource(notes, note) : null
          const liquidatable =
            note.tree === "loan" &&
            !!note.bond &&
            isUnderwater({
              bond: note.bond,
              loanAmount: note.amount,
              loanAsset: note.asset,
              prices,
              thresholdBps: liquidationThresholdBps,
            })
          return (
            <div
              className="flex flex-col gap-1 rounded-md border bg-background/64 px-2 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              key={`${note.tree}-${note.index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={note.tree === "loan" ? "warning" : "outline"}>
                  {note.tree}
                </Badge>
                <span className="font-mono">#{note.index}</span>
                <PrivateValue className="truncate font-mono text-muted-foreground">
                  {formatNoteAmount(note)}
                </PrivateValue>
                {note.tree === "loan" && note.openedAt ? (
                  <LoanAgeBadge openedAt={note.openedAt} />
                ) : null}
                {note.tree === "loan" && note.bond ? (
                  <LoanHealthBadge
                    bond={note.bond}
                    loanAmount={note.amount}
                    loanAsset={note.asset}
                    prices={prices}
                    thresholdBps={liquidationThresholdBps}
                  />
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                {liquidatable ? (
                  <Button
                    disabled={isLiquidateBusy || anyBusy}
                    onClick={() => onLiquidate(note)}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    {isLiquidateBusy ? (
                      <Loader2Icon
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : null}
                    Liquidate
                  </Button>
                ) : null}
                {repaySource ? (
                  <Button
                    disabled={isRepayBusy || anyBusy}
                    onClick={() => onRepay(note, repaySource)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isRepayBusy ? (
                      <Loader2Icon
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : null}
                    Repay
                  </Button>
                ) : null}
                <Button
                  disabled={isWithdrawBusy || anyBusy}
                  onClick={() => onWithdraw(note)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isWithdrawBusy ? (
                    <Loader2Icon aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {note.tree === "loan" ? "Claim" : "Withdraw"}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const STALE_LOAN_SECS = 30 * 24 * 60 * 60
const ORACLE_DECIMALS = 14n
const ORACLE_SCALE = 10n ** ORACLE_DECIMALS
const RAW_ORACLE_HEURISTIC = 10n ** 10n

function formatNoteAmount(note: ShieldedNote): string {
  if (note.tree === "loan" && note.amount >= RAW_ORACLE_HEURISTIC) {
    const whole = note.amount / ORACLE_SCALE
    const remainder = note.amount % ORACLE_SCALE
    const cents = (remainder * 100n) / ORACLE_SCALE
    const fractional = cents.toString().padStart(2, "0")
    return `~${whole.toString()}.${fractional} ${note.asset}`
  }
  return `${note.amount.toString()} ${note.asset}`
}

function pickRepaySource(
  notes: ShieldedNote[],
  loan: ShieldedNote
): ShieldedNote | null {
  let best: ShieldedNote | null = null
  for (const note of notes) {
    if (note.tree !== "deposit") continue
    if (note.asset !== loan.asset) continue
    if (note.amount < loan.amount) continue
    if (!best || note.amount < best.amount) best = note
  }
  return best
}

function isUnderwater({
  bond,
  loanAmount,
  loanAsset,
  prices,
  thresholdBps,
}: {
  bond: NonNullable<ShieldedNote["bond"]>
  loanAmount: bigint
  loanAsset: ShieldedAsset
  prices: Record<ShieldedAsset, number>
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

function LoanHealthBadge({
  bond,
  loanAmount,
  loanAsset,
  prices,
  thresholdBps,
}: {
  bond: NonNullable<ShieldedNote["bond"]>
  loanAmount: bigint
  loanAsset: ShieldedAsset
  prices: Record<ShieldedAsset, number>
  thresholdBps: number
}): React.ReactElement | null {
  const priceAsset = bond.collateralAsset ?? loanAsset
  const priceNow = prices[priceAsset]
  if (!priceNow || priceNow <= 0) return null
  const currentScaled = BigInt(Math.floor(priceNow * 1_000_000))
  const borrowScaled = bond.borrowPrice
  if (borrowScaled <= 0n || loanAmount <= 0n) return null

  const numerator = bond.collateralValue * currentScaled * 100n
  const denominator = borrowScaled * loanAmount
  if (denominator <= 0n) return null
  const hfPercent = Number(numerator / denominator)
  const liquidatable = hfPercent * thresholdBps < 10_000 * 100

  let variant: "outline" | "warning" | "destructive" = "outline"
  if (liquidatable) variant = "destructive"
  else if (hfPercent < 150) variant = "warning"

  return <Badge variant={variant}>HF {hfPercent}%</Badge>
}

function LoanAgeBadge({ openedAt }: { openedAt: number }): React.ReactElement {
  const nowSecs = useNowSecs()
  const age = Math.max(0, nowSecs - openedAt)
  const stale = age >= STALE_LOAN_SECS
  return (
    <Badge variant={stale ? "destructive" : "outline"}>
      {stale ? "stale · " : ""}
      {formatAge(age)}
    </Badge>
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

function useNowSecs(): number {
  return React.useSyncExternalStore(subscribeClock, getNowSecs, getNowSecs)
}

function getNowSecs(): number {
  return Math.floor(Date.now() / 1000)
}

function subscribeClock(callback: () => void): () => void {
  const id = window.setInterval(callback, 60_000)
  return () => window.clearInterval(id)
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}
