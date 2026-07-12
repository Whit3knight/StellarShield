"use client"

import { LayersIcon, Loader2Icon } from "lucide-react"
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
 * The single "manage my shielded notes" surface. Both deposit
 * (collateral) and loan notes render here with the burn actions
 * lifted out of the retiring shielded drawer:
 *   - deposit note → Withdraw (burn note, receive DENOMINATION out)
 *   - loan note → Claim (burn note, receive borrow amount out)
 *   - loan note → Repay (burn with a matching deposit note)
 *   - loan note → Liquidate (public trigger when underwater)
 *
 * All state derives from `useNotes()` decrypted memos — no wallet
 * address ever leaves the browser to render this list.
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
            Deposit + loan notes decrypted locally. Amount + wallet
            address never leave the browser to render this list.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-1.5" hideScrollbar>
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
            <NoteRows
              liquidatingIndex={showLiquidateBusy ? liquidatingIndex : null}
              liquidationThresholdBps={risk.liquidationThresholdBps}
              notes={notes}
              onLiquidate={(loan) => void liquidate(loan)}
              onRepay={(loan, deposit) => void repay(loan, deposit)}
              onWithdraw={(note) => void withdraw(note)}
              prices={prices}
              repayingIndex={showRepayBusy ? repayingIndex : null}
              withdrawingIndex={showWithdrawBusy ? withdrawingIndex : null}
            />
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
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

function NoteRows({
  liquidatingIndex,
  liquidationThresholdBps,
  notes,
  onLiquidate,
  onRepay,
  onWithdraw,
  prices,
  repayingIndex,
  withdrawingIndex,
}: {
  liquidatingIndex: number | null
  liquidationThresholdBps: number
  notes: ShieldedNote[]
  onLiquidate: (loan: ShieldedNote) => void
  onRepay: (loan: ShieldedNote, deposit: ShieldedNote) => void
  onWithdraw: (note: ShieldedNote) => void
  prices: Record<ShieldedAsset, number>
  repayingIndex: number | null
  withdrawingIndex: number | null
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      {notes.map((note) => {
        const isWithdrawBusy = withdrawingIndex === note.index
        const isRepayBusy = repayingIndex === note.index
        const isLiquidateBusy = liquidatingIndex === note.index
        const anyBusy =
          withdrawingIndex !== null ||
          repayingIndex !== null ||
          liquidatingIndex !== null
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
            className="flex items-center justify-between gap-2 rounded-md border bg-background/64 px-2 py-1.5 text-xs"
            key={`${note.tree}-${note.index}`}
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline">{note.asset}</Badge>
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
