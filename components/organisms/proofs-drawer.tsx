"use client"

import { CheckIcon, CopyIcon, ShieldCheckIcon } from "lucide-react"
import * as React from "react"

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
import type { BorrowEligibilityProof } from "@/features/proofs"
import { useMediaQuery } from "@/hooks/use-media-query"

type ProofsDrawerProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
  proofs: BorrowEligibilityProof[]
}

type ProofGroup = {
  failedCount: number
  latestExpiresAt: string
  latestGeneratedAt: string
  market: string
  proofs: BorrowEligibilityProof[]
  publicInputs: BorrowEligibilityProof["publicInputs"]
  verifiedCount: number
}

export function ProofsDrawer({
  onOpenChange,
  open,
  proofs,
}: ProofsDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery("max-lg")
  const groups = React.useMemo(() => groupByMarket(proofs), [proofs])

  return (
    <Drawer
      onOpenChange={onOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <DrawerTitle>Proofs</DrawerTitle>
          <DrawerDescription className="mt-2">
            Eligibility proofs grouped by market pair.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {groups.length === 0 ? (
            <EmptyState />
          ) : (
            groups.map((group) => <GroupCard group={group} key={group.market} />)
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldCheckIcon />
        </EmptyMedia>
        <EmptyTitle>No proofs generated yet</EmptyTitle>
        <EmptyDescription>
          Complete the verification step in a borrow flow to record a proof.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function GroupCard({ group }: { group: ProofGroup }): React.ReactElement {
  const badge = pickBadge(group)
  const fields: PositionCardField[] = [
    { label: "HF min", value: group.publicInputs.healthFactorMin },
    { label: "Max LTV", value: group.publicInputs.maxLtv },
    {
      label: "Latest expiry",
      value: formatRelativeExpiry(new Date(group.latestExpiresAt)),
    },
  ]

  return (
    <PositionCard
      badge={badge}
      fields={fields}
      footer={<ProofIdsAccordion proofs={group.proofs} />}
      title={group.market}
    />
  )
}

function pickBadge(group: ProofGroup): React.ReactElement {
  if (group.failedCount > 0 && group.verifiedCount === 0) {
    return <Badge variant="destructive">Failed</Badge>
  }
  if (group.failedCount > 0) {
    return <Badge variant="warning">Mixed</Badge>
  }
  return <Badge variant="success">Verified</Badge>
}

function ProofIdsAccordion({
  proofs,
}: {
  proofs: BorrowEligibilityProof[]
}): React.ReactElement {
  const sorted = [...proofs].sort((a, b) =>
    (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "")
  )
  return (
    <Accordion>
      <AccordionItem className="border-b-0 border-t" value="proofs">
        <AccordionTrigger className="gap-2 pt-2 pb-4 text-sm font-normal text-muted-foreground">
          <span>Proofs</span>
          <span className="ml-auto font-medium text-foreground">
            {proofs.length}
          </span>
        </AccordionTrigger>
        <AccordionPanel className="flex flex-col gap-1.5 pb-1 text-xs">
          {sorted.map((proof) => (
            <ProofIdRow key={proof.id} proof={proof} />
          ))}
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}

function ProofIdRow({
  proof,
}: {
  proof: BorrowEligibilityProof
}): React.ReactElement {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(proof.id)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [proof.id])

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-background/64 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1 font-mono">
        <PrivateValue className="truncate">{shortHash(proof.id)}</PrivateValue>
        <Button
          aria-label={copied ? "Proof id copied" : "Copy proof id"}
          onClick={handleCopy}
          size="icon-xs"
          title={copied ? "Copied" : "Copy proof id"}
          type="button"
          variant="ghost"
        >
          {copied ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <CopyIcon aria-hidden="true" />
          )}
        </Button>
      </div>
      <span className="text-muted-foreground">
        {formatTimestamp(proof.generatedAt)}
      </span>
    </div>
  )
}

function groupByMarket(proofs: BorrowEligibilityProof[]): ProofGroup[] {
  const buckets = new Map<string, BorrowEligibilityProof[]>()
  for (const proof of proofs) {
    const key = proof.publicInputs.market
    const list = buckets.get(key) ?? []
    list.push(proof)
    buckets.set(key, list)
  }

  return Array.from(buckets.entries()).map(([market, list]) => {
    const latestExpiresAt =
      list.map((p) => p.expiresAt).sort().at(-1) ?? new Date(0).toISOString()
    const latestGeneratedAt =
      list
        .map((p) => p.generatedAt ?? "")
        .filter(Boolean)
        .sort()
        .at(-1) ?? new Date(0).toISOString()
    return {
      failedCount: list.filter((p) => p.status === "Failed").length,
      latestExpiresAt,
      latestGeneratedAt,
      market,
      proofs: list,
      publicInputs: list[0].publicInputs,
      verifiedCount: list.filter((p) => p.status === "Verified").length,
    }
  })
}

function shortHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

function formatRelativeExpiry(expiresAt: Date): string {
  const diff = expiresAt.getTime() - Date.now()
  const past = diff < 0
  const seconds = Math.abs(Math.round(diff / 1_000))

  if (seconds < 60) return past ? `${seconds}s ago` : `in ${seconds}s`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`

  const hours = Math.round(minutes / 60)
  if (hours < 48) return past ? `${hours}h ago` : `in ${hours}h`

  const days = Math.round(hours / 24)
  return past ? `${days}d ago` : `in ${days}d`
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
