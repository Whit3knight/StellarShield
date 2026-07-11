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
import { useDeposit, useShieldedPool } from "@/features/shielded-pool"
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
              <NoteList notes={notes} isScanning={isScanning} />
            </>
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
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
}: {
  notes: ShieldedNote[]
  isScanning: boolean
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
      {notes.map((note) => (
        <div
          className="flex items-center justify-between gap-2 rounded-md border bg-background/64 px-2 py-1.5 text-xs"
          key={`${note.tree}-${note.index}`}
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline">{note.asset}</Badge>
            <span className="font-mono">#{note.index}</span>
          </div>
          <PrivateValue className="truncate font-mono">
            {`${note.amount.toString()} ${note.asset}`}
          </PrivateValue>
        </div>
      ))}
    </div>
  )
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
