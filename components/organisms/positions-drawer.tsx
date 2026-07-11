"use client"

import { LayersIcon, Loader2Icon } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useRepayPosition } from "@/features/borrow-flow/use-repay-position"
import type { ChainBorrowReceipt } from "@/features/protocol"
import { getStellarExpertAccountUrl } from "@/features/wallet/network"
import { useMediaQuery } from "@/hooks/use-media-query"

type PositionsDrawerProps = {
  account?: string | null
  chainLoading?: boolean
  chainPositions?: ChainBorrowReceipt[]
  onOpenChange: (open: boolean) => void
  onRepaid?: () => void
  open: boolean
}

export function PositionsDrawer({
  account = null,
  chainLoading = false,
  chainPositions = EMPTY_CHAIN_LIST,
  onOpenChange,
  onRepaid,
  open,
}: PositionsDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const groups = React.useMemo(
    () => groupChainReceipts(chainPositions),
    [chainPositions]
  )

  const nothingToShow =
    groups.length === 0 && chainPositions.length === 0 && !chainLoading

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
            On-chain borrow positions grouped by market pair.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {nothingToShow ? <EmptyState /> : null}
          {groups.map((group) => (
            <GroupCard
              account={account}
              group={group}
              key={group.market}
              onRepaid={onRepaid}
            />
          ))}
          {chainLoading && groups.length === 0 ? (
            <GroupCard account={account} group={null} onRepaid={onRepaid} />
          ) : null}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

const EMPTY_CHAIN_LIST: ChainBorrowReceipt[] = []

type ChainGroup = {
  market: string
  receipts: ChainBorrowReceipt[]
}

function groupChainReceipts(receipts: ChainBorrowReceipt[]): ChainGroup[] {
  const byMarket = new Map<string, ChainBorrowReceipt[]>()
  for (const receipt of receipts) {
    const pair = `${receipt.borrowSymbol}/${receipt.collateralSymbol}`
    const list = byMarket.get(pair) ?? []
    list.push(receipt)
    byMarket.set(pair, list)
  }
  return Array.from(byMarket.entries()).map(([market, list]) => ({
    market,
    receipts: list.sort((a, b) => b.confirmedAt - a.confirmedAt),
  }))
}

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
  account,
  group,
  onRepaid,
}: {
  account: string | null
  group: ChainGroup | null
  onRepaid?: () => void
}): React.ReactElement {
  const latest = group?.receipts[0] ?? null
  const subtitle = group?.market

  const fields: PositionCardField[] = []
  if (latest) {
    fields.push(
      {
        label: "On-chain confirmed",
        value: formatTimestamp(new Date(latest.confirmedAt * 1000).toISOString()),
      },
      {
        label: "Proof id",
        value: (
          <PrivateValue className="truncate font-mono">
            {shortHash(latest.proofId)}
          </PrivateValue>
        ),
      },
      {
        label: "Account",
        value: (
          <ExternalLink
            className="justify-end font-mono"
            href={getStellarExpertAccountUrl(latest.account)}
          >
            <PrivateValue className="truncate">
              {shortHash(latest.account)}
            </PrivateValue>
          </ExternalLink>
        ),
      }
    )
  } else {
    fields.push(
      { label: "On-chain confirmed", value: <Skeleton className="ml-auto h-3.5 w-28" /> },
      { label: "Proof id", value: <Skeleton className="ml-auto h-3.5 w-20" /> },
      { label: "Account", value: <Skeleton className="ml-auto h-3.5 w-24" /> }
    )
  }

  fields.push({
    label: "Amounts",
    value: (
      <span className="italic text-muted-foreground">
        Hidden (private witness)
      </span>
    ),
  })

  const chainCount = group?.receipts.length ?? 0
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
        group ? (
          <ReceiptsAccordion
            account={account}
            onRepaid={onRepaid}
            receipts={group.receipts}
          />
        ) : null
      }
      subtitle={subtitle}
      title="Position open"
    />
  )
}

function ReceiptsAccordion({
  account,
  onRepaid,
  receipts,
}: {
  account: string | null
  onRepaid?: () => void
  receipts: ChainBorrowReceipt[]
}): React.ReactElement {
  const {
    activeProofId,
    message,
    repay,
    status,
  } = useRepayPosition(account)

  React.useEffect(() => {
    if (status !== "success") return
    onRepaid?.()
  }, [status, onRepaid])

  return (
    <Accordion>
      <AccordionItem className="border-b-0 border-t" value="receipts">
        <AccordionTrigger className="gap-2 pt-2 pb-4 text-sm font-normal text-muted-foreground">
          <span>Positions</span>
          <span className="ml-auto font-medium text-foreground">
            {receipts.length}
          </span>
        </AccordionTrigger>
        <AccordionPanel className="flex flex-col gap-1.5 pb-1 text-xs">
          {receipts.map((receipt) => {
            const isActive = activeProofId === receipt.proofId
            return (
              <ReceiptRow
                errorMessage={
                  isActive && status === "failed" ? message : null
                }
                isPending={isActive && status === "pending"}
                key={receipt.proofId}
                onRepay={() => repay(receipt.proofId)}
                receipt={receipt}
                repayDisabled={!account || status === "pending"}
              />
            )
          })}
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}

function ReceiptRow({
  errorMessage,
  isPending,
  onRepay,
  receipt,
  repayDisabled,
}: {
  errorMessage: string | null
  isPending: boolean
  onRepay: () => void
  receipt: ChainBorrowReceipt
  repayDisabled: boolean
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background/64 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <PrivateValue className="truncate font-mono text-foreground">
          {shortHash(receipt.proofId)}
        </PrivateValue>
        <span className="text-muted-foreground">
          {formatTimestamp(new Date(receipt.confirmedAt * 1000).toISOString())}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {errorMessage ?? "Owner-signed close"}
        </span>
        <Button
          disabled={repayDisabled}
          onClick={onRepay}
          size="sm"
          type="button"
          variant="outline"
        >
          {isPending ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : null}
          Repay
        </Button>
      </div>
    </div>
  )
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
