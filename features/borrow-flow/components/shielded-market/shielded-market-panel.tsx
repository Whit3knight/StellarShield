"use client"

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldCheckIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { useNavMenus } from "@/app/_hooks/use-nav-menus"
import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardPanel } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  deriveMarketMetrics,
  formatPercent,
  formatUsdCompact,
  useAssetPrices,
  useMarketStats,
  type MarketCardData,
} from "@/features/markets"
import { COLLATERAL_NOTES_PER_BORROW, DENOMINATION } from "@/features/notes"
import { useRiskParams } from "@/features/protocol/risk-params"

import { useShieldedMarketFlow } from "../../hooks/use-shielded-market-flow"

type ShieldedMarketPanelProps = {
  account: ConnectedAccount | null
  market: MarketCardData
  onClose: () => void
}

/**
 * Right-side workspace panel shown when a market card is selected.
 * Runs the whole shielded borrow flow inline: shield collateral notes,
 * generate + submit the borrow proof, show the confirmation receipt.
 * No nested drawers, no legacy borrow-intent flow.
 */
export function ShieldedMarketPanel({
  account,
  market,
  onClose,
}: ShieldedMarketPanelProps): React.ReactElement {
  const flow = useShieldedMarketFlow({ market })
  const risk = useRiskParams()
  const prices = useAssetPrices()
  const { stats } = useMarketStats()
  const marketStat = stats[market.symbol]
  const metrics = deriveMarketMetrics(marketStat, market.symbol)

  const collateralPrice = prices[market.collateral] ?? 0
  const collateralValueUsd =
    Number(flow.collateralAmount || 0) * collateralPrice
  const targetCollateralWhole =
    flow.targetNoteCount * Number(DENOMINATION[market.collateral])
  const targetCollateralUsd = targetCollateralWhole * collateralPrice
  const expectedLoanValueUsd =
    (targetCollateralUsd * risk.maxLtvBps) / 10_000

  return (
    <aside className="ml-4 hidden min-h-0 min-w-0 lg:block">
      <Card className="relative isolate flex h-full flex-col overflow-hidden rounded-lg">
        <PanelHeader
          market={market}
          metrics={metrics}
          onClose={onClose}
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 scrollbar-none">
          <MetricStrip
            borrowApr={metrics.borrowApr}
            marketPair={`${market.symbol}/${market.collateral}`}
            supplyApy={metrics.supplyApy}
            utilization={metrics.utilization}
          />

          {!account ? (
            <NoWalletSection />
          ) : (
            <>
              <CollateralSection
                collateralAmount={flow.collateralAmount}
                collateralAsset={market.collateral}
                collateralValueUsd={collateralValueUsd}
                depositProgress={flow.depositProgress}
                errorMessage={flow.errorMessage}
                onAmountChange={flow.setCollateralAmount}
                onShield={flow.runDeposits}
                ownedNoteCount={flow.ownedNoteCount}
                phase={flow.phase}
                targetCollateralWhole={targetCollateralWhole}
                targetNoteCount={flow.targetNoteCount}
              />

              <BorrowSection
                borrowAsset={market.symbol}
                collateralAsset={market.collateral}
                errorMessage={flow.errorMessage}
                expectedLoanValueUsd={expectedLoanValueUsd}
                maxLtvBps={risk.maxLtvBps}
                onBorrow={flow.runBorrow}
                phase={flow.phase}
                ready={flow.ready}
              />

              {flow.phase === "confirmed" && flow.txHash ? (
                <ReceiptSection
                  borrowAsset={market.symbol}
                  onReset={flow.reset}
                  txHash={flow.txHash}
                />
              ) : null}
            </>
          )}
        </div>
      </Card>
    </aside>
  )
}

function PanelHeader({
  market,
  metrics,
  onClose,
}: {
  market: MarketCardData
  metrics: ReturnType<typeof deriveMarketMetrics>
  onClose: () => void
}): React.ReactElement {
  return (
    <div className="border-b bg-muted/40 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            Borrow via shielded pool
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            {market.symbol}
            <span className="text-muted-foreground">/{market.collateral}</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deposit collateral, generate the ZK proof, sign borrow — all
            without linking the wallet on-chain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{metrics.utilization > 0.7 ? "Active" : "Standard"}</Badge>
          <Button
            aria-label="Close panel"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function MetricStrip({
  borrowApr,
  marketPair,
  supplyApy,
  utilization,
}: {
  borrowApr: number
  marketPair: string
  supplyApy: number
  utilization: number
}): React.ReactElement {
  return (
    <div className="grid grid-cols-4 gap-1 text-xs">
      <MetricCell label="Market" value={marketPair} />
      <MetricCell label="Borrow APR" value={formatPercent(borrowApr * 100)} />
      <MetricCell label="Supply APY" value={formatPercent(supplyApy * 100)} />
      <MetricCell
        label="Utilization"
        value={`${Math.round(utilization * 100)}%`}
      />
    </div>
  )
}

function MetricCell({
  label,
  value,
}: {
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background/64 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
    </div>
  )
}

function NoWalletSection(): React.ReactElement {
  const { connectDialog } = useNavMenus()
  return (
    <CardPanel className="flex flex-col items-center gap-3 p-6 text-center">
      <WalletIcon aria-hidden="true" className="size-8 text-muted-foreground" />
      <div>
        <div className="font-medium">Connect a wallet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          The shielded flow derives your note identity from the wallet
          seed — nothing runs until you connect.
        </p>
      </div>
      <Button onClick={() => connectDialog.setOpen(true)} type="button">
        <WalletIcon aria-hidden="true" />
        Connect wallet
      </Button>
    </CardPanel>
  )
}

function CollateralSection({
  collateralAmount,
  collateralAsset,
  collateralValueUsd,
  depositProgress,
  errorMessage,
  onAmountChange,
  onShield,
  ownedNoteCount,
  phase,
  targetCollateralWhole,
  targetNoteCount,
}: {
  collateralAmount: string
  collateralAsset: string
  collateralValueUsd: number
  depositProgress: { done: number; total: number }
  errorMessage: string | null
  onAmountChange: (value: string) => void
  onShield: () => Promise<void>
  ownedNoteCount: number
  phase: string
  targetCollateralWhole: number
  targetNoteCount: number
}): React.ReactElement {
  const busy = phase === "depositing"
  const additionalNeeded = Math.max(0, targetNoteCount - ownedNoteCount)
  const enoughAlready = ownedNoteCount >= COLLATERAL_NOTES_PER_BORROW

  return (
    <section className="rounded-md border bg-background/64 p-4">
      <SectionHeader
        icon={<ShieldCheckIcon aria-hidden="true" className="size-4" />}
        step={1}
        subtitle={
          enoughAlready
            ? `You already have ${ownedNoteCount} shielded ${collateralAsset} notes.`
            : `Shield ${collateralAsset} into the pool as collateral.`
        }
        title="Add shielded collateral"
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Collateral amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>{collateralAsset}</InputGroupAddon>
            <InputGroupInput
              className="*:[input]:ps-0!"
              disabled={busy}
              inputMode="decimal"
              onChange={(event) => onAmountChange(event.currentTarget.value)}
              placeholder={`${targetCollateralWhole}`}
              step="0.01"
              type="number"
              value={collateralAmount}
            />
          </InputGroup>
          <FieldDescription>
            Approx {formatUsdCompact(collateralValueUsd)} at the current
            oracle price.
          </FieldDescription>
        </Field>
        <div className="grid gap-2 text-xs">
          <StatusRow
            label="You have"
            value={`${ownedNoteCount} note${ownedNoteCount === 1 ? "" : "s"}`}
          />
          <StatusRow
            label="You need"
            value={`${targetNoteCount} note${targetNoteCount === 1 ? "" : "s"}`}
          />
          <StatusRow
            label="To shield now"
            highlight={additionalNeeded > 0}
            value={`${additionalNeeded} note${additionalNeeded === 1 ? "" : "s"}`}
          />
        </div>
      </div>

      {busy ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon
            aria-hidden="true"
            className="size-3.5 animate-spin"
          />
          Shielding note {depositProgress.done + 1} of {depositProgress.total}…
        </div>
      ) : null}

      {phase === "failed" && errorMessage ? (
        <FieldError className="mt-2">{errorMessage}</FieldError>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        {additionalNeeded === 0 ? (
          <Badge variant="success">
            <CheckCircle2Icon aria-hidden="true" className="size-3" />
            Collateral ready
          </Badge>
        ) : (
          <Button
            disabled={busy || additionalNeeded === 0}
            onClick={() => void onShield()}
            type="button"
          >
            {busy ? (
              <Loader2Icon
                aria-hidden="true"
                className="size-3.5 animate-spin"
              />
            ) : null}
            Shield {additionalNeeded} × {DENOMINATION[collateralAsset as keyof typeof DENOMINATION].toString()} {collateralAsset}
          </Button>
        )}
      </div>
    </section>
  )
}

function BorrowSection({
  borrowAsset,
  collateralAsset,
  errorMessage,
  expectedLoanValueUsd,
  maxLtvBps,
  onBorrow,
  phase,
  ready,
}: {
  borrowAsset: string
  collateralAsset: string
  errorMessage: string | null
  expectedLoanValueUsd: number
  maxLtvBps: number
  onBorrow: () => Promise<void>
  phase: string
  ready: boolean
}): React.ReactElement {
  const busy = phase === "borrowing"
  const done = phase === "confirmed"
  const showError = phase === "failed" && errorMessage
  return (
    <section className="rounded-md border bg-background/64 p-4">
      <SectionHeader
        icon={<ArrowRightIcon aria-hidden="true" className="size-4" />}
        step={2}
        subtitle={
          done
            ? "Loan minted."
            : ready
              ? `Prove ownership of ${COLLATERAL_NOTES_PER_BORROW} shielded ${collateralAsset} notes → receive a shielded ${borrowAsset} loan.`
              : `Shield ${COLLATERAL_NOTES_PER_BORROW} ${collateralAsset} notes first.`
        }
        title="Generate + submit borrow"
      />

      <div className="mt-3 grid gap-2 text-xs">
        <StatusRow
          label="Max LTV"
          value={`${(maxLtvBps / 100).toFixed(1)}%`}
        />
        <StatusRow
          label="Expected loan value"
          value={
            <PrivateValue>
              {formatUsdCompact(expectedLoanValueUsd)}
            </PrivateValue>
          }
        />
      </div>

      {showError ? (
        <FieldError className="mt-2">{errorMessage}</FieldError>
      ) : null}

      <div className="mt-3 flex items-center justify-end">
        <Button
          disabled={!ready || busy || done}
          onClick={() => void onBorrow()}
          type="button"
        >
          {busy ? (
            <Loader2Icon
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
          ) : null}
          {done ? "Borrow confirmed" : busy ? "Signing…" : "Sign borrow"}
        </Button>
      </div>
    </section>
  )
}

function ReceiptSection({
  borrowAsset,
  onReset,
  txHash,
}: {
  borrowAsset: string
  onReset: () => void
  txHash: string
}): React.ReactElement {
  return (
    <section className="rounded-md border border-primary/40 bg-primary/5 p-4">
      <SectionHeader
        icon={<CheckCircle2Icon aria-hidden="true" className="size-4" />}
        step={3}
        subtitle={`Loan note minted; visible in the Positions drawer.`}
        title="Borrow confirmed"
      />
      <div className="mt-3 flex flex-col gap-2 text-xs">
        <StatusRow
          label="Transaction"
          value={
            <a
              className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              rel="noreferrer"
              target="_blank"
            >
              {txHash.slice(0, 6)}…{txHash.slice(-6)}
              <ExternalLinkIcon aria-hidden="true" className="size-3" />
            </a>
          }
        />
        <StatusRow label="Asset" value={borrowAsset} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button onClick={onReset} size="sm" type="button" variant="outline">
          Start another borrow
        </Button>
      </div>
    </section>
  )
}

function SectionHeader({
  icon,
  step,
  subtitle,
  title,
}: {
  icon: React.ReactNode
  step: number
  subtitle: string
  title: string
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2">
      <Badge className="mt-0.5" variant="outline">
        Step {step}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium">
          {icon}
          {title}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function StatusRow({
  highlight = false,
  label,
  value,
}: {
  highlight?: boolean
  label: string
  value: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? "font-medium text-foreground" : ""}>
        {value}
      </span>
    </div>
  )
}
