"use client"

import { LockIcon, Loader2Icon } from "lucide-react"
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
import {
  DENOMINATION,
  SUPPORTED_ASSETS,
  useNotes,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import {
  useBorrow,
  useDeposit,
  useRepay,
  useShieldedPool,
  useWithdraw,
} from "@/features/shielded-pool"
import { useMediaQuery } from "@/hooks/use-media-query"

type ShieldedDrawerProps = {
  account: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function ShieldedDrawer({
  account,
  onOpenChange,
  open,
}: ShieldedDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const { identity, isScanning } = useShieldedPool(account)
  const notes = useNotes()
  const walletSeed = identity?.secretKey ?? null
  const { deposit, status } = useDeposit(account, walletSeed)
  const {
    activeNoteIndex: withdrawingIndex,
    status: withdrawStatus,
    withdraw,
  } = useWithdraw(account)
  const { borrow, status: borrowStatus } = useBorrow(account, walletSeed)
  const {
    activeLoanIndex: repayingIndex,
    status: repayStatus,
    repay,
  } = useRepay(account)

  const balances = React.useMemo(() => summariseByAsset(notes), [notes])

  return (
    <Drawer
      onOpenChange={onOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <DrawerTitle>Shielded pool</DrawerTitle>
          <DrawerDescription className="mt-2">
            Amount + wallet address hidden. Notes derive from your wallet
            seed on connect.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-3" hideScrollbar>
          {!account ? (
            <EmptyPanel
              title="Connect a wallet"
              description="Shielded balances derive from the connected wallet's key."
            />
          ) : (
            <>
              <BalanceGrid
                balances={balances}
                isScanning={isScanning}
                onDeposit={async (asset) => {
                  await deposit(asset)
                }}
                depositStatus={status}
              />
              <BorrowPanel
                availableCollateral={balances}
                borrowStatus={borrowStatus}
                onBorrow={async ({ borrowAsset, collateralAsset }) => {
                  await borrow({ borrowAsset, collateralAsset })
                }}
              />
              <NoteList
                notes={notes}
                isScanning={isScanning}
                onWithdraw={(note) => void withdraw(note)}
                onRepay={(loan, deposit) => void repay(loan, deposit)}
                repayingIndex={
                  repayStatus === "idle" || repayStatus === "success"
                    ? null
                    : repayingIndex
                }
                withdrawingIndex={
                  withdrawStatus === "idle" || withdrawStatus === "success"
                    ? null
                    : withdrawingIndex
                }
              />
            </>
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function BorrowPanel({
  availableCollateral,
  borrowStatus,
  onBorrow,
}: {
  availableCollateral: Record<ShieldedAsset, number>
  borrowStatus: "idle" | "reconstructing" | "proving" | "signing" | "success" | "failed"
  onBorrow: (params: {
    borrowAsset: ShieldedAsset
    collateralAsset: ShieldedAsset
  }) => Promise<void>
}): React.ReactElement | null {
  const busy =
    borrowStatus === "reconstructing" ||
    borrowStatus === "proving" ||
    borrowStatus === "signing"
  const eligible = SUPPORTED_ASSETS.filter(
    (asset) => availableCollateral[asset] >= 4
  )
  if (eligible.length === 0) return null

  return (
    <div className="rounded-md border bg-background/72 px-3 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Borrow shielded</div>
          <p className="text-xs text-muted-foreground">
            4 collateral notes → 1 loan note, amounts + wallet hidden.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {eligible.map((collateral) =>
          SUPPORTED_ASSETS.filter((borrow) => borrow !== collateral).map(
            (borrowAsset) => (
              <Button
                disabled={busy}
                key={`${collateral}-${borrowAsset}`}
                onClick={() =>
                  void onBorrow({
                    borrowAsset,
                    collateralAsset: collateral,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                {busy ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : null}
                {collateral} → {borrowAsset}
              </Button>
            )
          )
        )}
      </div>
    </div>
  )
}

function BalanceGrid({
  balances,
  depositStatus,
  isScanning,
  onDeposit,
}: {
  balances: Record<ShieldedAsset, number>
  depositStatus: "idle" | "proving" | "signing" | "success" | "failed"
  isScanning: boolean
  onDeposit: (asset: ShieldedAsset) => Promise<void>
}): React.ReactElement {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {SUPPORTED_ASSETS.map((asset) => (
        <div
          className="flex flex-col gap-2 rounded-md border bg-background/72 px-3 py-3"
          key={asset}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{asset}</span>
            <Badge variant="outline">{DENOMINATION[asset].toString()}/note</Badge>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold">
              {isScanning ? "…" : balances[asset]}
            </span>
            <span className="text-xs text-muted-foreground">notes</span>
          </div>
          <Button
            className="justify-center"
            disabled={
              depositStatus === "proving" || depositStatus === "signing"
            }
            onClick={() => void onDeposit(asset)}
            size="sm"
            type="button"
            variant="outline"
          >
            {depositStatus === "proving" || depositStatus === "signing" ? (
              <Loader2Icon aria-hidden="true" className="animate-spin" />
            ) : null}
            Deposit
          </Button>
        </div>
      ))}
    </div>
  )
}

function NoteList({
  notes,
  isScanning,
  onRepay,
  onWithdraw,
  repayingIndex,
  withdrawingIndex,
}: {
  notes: ShieldedNote[]
  isScanning: boolean
  onRepay: (loan: ShieldedNote, deposit: ShieldedNote) => void
  onWithdraw: (note: ShieldedNote) => void
  repayingIndex: number | null
  withdrawingIndex: number | null
}): React.ReactElement {
  if (isScanning && notes.length === 0) {
    return (
      <EmptyPanel
        title="Scanning"
        description="Reading deposit events + decrypting memos."
      />
    )
  }
  if (notes.length === 0) {
    return (
      <EmptyPanel
        title="No notes yet"
        description="Deposit into the shielded pool to mint your first note."
      />
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {notes.map((note) => {
        const isWithdrawBusy = withdrawingIndex === note.index
        const isRepayBusy = repayingIndex === note.index
        const anyBusy =
          withdrawingIndex !== null || repayingIndex !== null
        const repaySource =
          note.tree === "loan"
            ? pickRepaySource(notes, note)
            : null
        return (
          <div
            className="flex items-center justify-between gap-2 rounded-md border bg-background/64 px-2 py-1.5 text-xs"
            key={`${note.tree}-${note.index}`}
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline">{note.asset}</Badge>
              <span className="font-mono">#{note.index}</span>
              <PrivateValue className="truncate font-mono text-muted-foreground">
                {`${note.amount.toString()} ${note.asset}`}
              </PrivateValue>
              {note.tree === "loan" && note.openedAt ? (
                <LoanAgeBadge openedAt={note.openedAt} />
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
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

/**
 * Smallest deposit note in the same asset whose amount covers the
 * loan. Prefers minimal over-repayment so the pool retains as little
 * as possible as fee.
 */
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

function EmptyPanel({
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
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function summariseByAsset(
  notes: ShieldedNote[]
): Record<ShieldedAsset, number> {
  const totals: Record<ShieldedAsset, number> = {
    EURC: 0,
    USDC: 0,
    XLM: 0,
  }
  for (const note of notes) {
    if (note.tree === "deposit") totals[note.asset] += 1
  }
  return totals
}
