"use client"

import {
  ArrowRightIcon,
  LockIcon,
  Loader2Icon,
} from "lucide-react"
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
  COLLATERAL_NOTES_PER_BORROW,
  DENOMINATION,
  SUPPORTED_ASSETS,
  useNotes,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { useAssetPrices } from "@/features/markets"
import { useRiskParams } from "@/features/protocol/risk-params"
import {
  useBorrow,
  useDeposit,
  useLiquidate,
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
  const { deposit, status } = useDeposit(account, identity)
  const {
    activeNoteIndex: withdrawingIndex,
    status: withdrawStatus,
    withdraw,
  } = useWithdraw(account)
  const { borrow, status: borrowStatus } = useBorrow(account, identity)
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

  const balances = React.useMemo(() => summariseByAsset(notes), [notes])
  const prices = useAssetPrices()
  const risk = useRiskParams()

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
                liquidatingIndex={
                  liquidateStatus === "idle" ||
                  liquidateStatus === "success"
                    ? null
                    : liquidatingIndex
                }
                liquidationThresholdBps={risk.liquidationThresholdBps}
                notes={notes}
                isScanning={isScanning}
                onLiquidate={(loan) => void liquidate(loan)}
                onWithdraw={(note) => void withdraw(note)}
                onRepay={(loan, deposit) => void repay(loan, deposit)}
                prices={prices}
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
    (asset) => availableCollateral[asset] >= COLLATERAL_NOTES_PER_BORROW
  )
  if (eligible.length === 0) return null

  return (
    <div className="rounded-md border bg-background/72 px-3 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Borrow shielded</div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {COLLATERAL_NOTES_PER_BORROW} collateral notes
            <ArrowRightIcon aria-hidden="true" className="size-3" />
            1 loan note, amounts + wallet hidden.
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
                {collateral}
                <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                {borrowAsset}
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
            <Badge variant="outline">{DENOMINATION[asset].toString()} {asset}/note</Badge>
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
  liquidatingIndex,
  liquidationThresholdBps,
  notes,
  isScanning,
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
  isScanning: boolean
  onLiquidate: (loan: ShieldedNote) => void
  onRepay: (loan: ShieldedNote, deposit: ShieldedNote) => void
  onWithdraw: (note: ShieldedNote) => void
  prices: Record<ShieldedAsset, number>
  repayingIndex: number | null
  withdrawingIndex: number | null
}): React.ReactElement {
  if (isScanning && notes.length === 0) {
    return (
      <EmptyPanel
        title="Scanning"
        description="Replaying deposit, loan, and repay events + decrypting memos."
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
        const isLiquidateBusy = liquidatingIndex === note.index
        const anyBusy =
          withdrawingIndex !== null ||
          repayingIndex !== null ||
          liquidatingIndex !== null
        const repaySource =
          note.tree === "loan"
            ? pickRepaySource(notes, note)
            : null
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

/**
 * Shared underwater predicate used by both the health badge and the
 * liquidate button. Matches the constraint the liquidate circuit
 * enforces:
 *   loan_amount * threshold_bps * borrow_price
 *     > collateral_notional * current_price * 10_000
 * scaled up on the client because current_price is a JS float.
 */
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
  // `bond.borrowPrice` is the collateral asset's Reflector price at
  // borrow time; the ratio in this HF check is `priceNow /
  // priceAtBorrow` for the SAME asset feed. Falling back to `loanAsset`
  // for legacy notes without a memoised `collateralAsset` is only
  // correct when collateral and loan share an asset.
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

/**
 * Compute the loan's current health factor from its pinned bond
 * openings + the latest Reflector price. Same math as the liquidate
 * circuit's underwater check, run client-side for a warning badge.
 *
 *   collateral_value_now = collateralValue * priceNow / borrowPrice
 *   hf_ratio             = collateral_value_now / loan_amount
 *   underwater           = hf_ratio * threshold_bps < 10_000
 */
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
  // `bond.borrowPrice` is the collateral asset's Reflector price at
  // borrow time, so the ratio in this HF check is `priceNow /
  // priceAtBorrow` for the SAME asset feed. Falling back to `loanAsset`
  // for legacy notes without a memoised `collateralAsset` is only
  // correct when collateral and loan share an asset.
  const priceAsset = bond.collateralAsset ?? loanAsset
  const priceNow = prices[priceAsset]
  if (!priceNow || priceNow <= 0) return null
  const currentScaled = BigInt(Math.floor(priceNow * 1_000_000))
  const borrowScaled = bond.borrowPrice
  if (borrowScaled <= 0n || loanAmount <= 0n) return null

  // hf_percent = collateralValue * currentScaled * 100 / (borrowScaled * loanAmount)
  const numerator = bond.collateralValue * currentScaled * 100n
  const denominator = borrowScaled * loanAmount
  if (denominator <= 0n) return null
  const hfPercent = Number(numerator / denominator)
  const liquidatable = hfPercent * thresholdBps < 10_000 * 100

  let variant: "outline" | "warning" | "destructive" = "outline"
  if (liquidatable) variant = "destructive"
  else if (hfPercent < 150) variant = "warning"

  return (
    <Badge variant={variant}>
      HF {hfPercent}%
    </Badge>
  )
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

// Reflector Pulse quotes prices at 14-decimal precision, and the
// shielded-borrow circuit multiplies the raw oracle price into
// `borrow_amount` — so a Reflector-priced loan note ends up storing an
// amount scaled by 10^14 that the withdraw circuit reads back verbatim.
// Loan notes therefore land in the tree with a bigint two orders of
// magnitude away from a token unit, and printing the raw number reads
// as noise. Deposit notes are still whole-denomination bigints.
//
// ponytail: presentation-only normalisation. The underlying scale
// mismatch between the oracle input and the token transfer is a
// circuit-level issue that needs a proper reconciliation
// (see `features/shielded-pool/borrow-prover.ts` — oraclePrice is fed
// raw). Until that lands, this heuristic keeps the drawer readable
// without lying about which value the contract actually enforces.
const ORACLE_DECIMALS = 14n
const ORACLE_SCALE = 10n ** ORACLE_DECIMALS
const RAW_ORACLE_HEURISTIC = 10n ** 10n

function formatNoteAmount(note: ShieldedNote): string {
  if (note.tree === "loan" && note.amount >= RAW_ORACLE_HEURISTIC) {
    // Value is oracle-scaled (14 decimals). Show whole-unit approximation.
    const whole = note.amount / ORACLE_SCALE
    const remainder = note.amount % ORACLE_SCALE
    const cents = (remainder * 100n) / ORACLE_SCALE
    const fractional = cents.toString().padStart(2, "0")
    return `~${whole.toString()}.${fractional} ${note.asset}`
  }
  return `${note.amount.toString()} ${note.asset}`
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
