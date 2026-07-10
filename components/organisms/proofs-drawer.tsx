"use client"

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ShieldCheckIcon,
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
import { cn } from "@/lib/utils"
import type { BorrowEligibilityProof } from "@/features/proofs"
import { useIsMobile } from "@/hooks/use-media-query"

type ProofsDrawerProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
  proofs: BorrowEligibilityProof[]
}

export function ProofsDrawer({
  onOpenChange,
  open,
  proofs,
}: ProofsDrawerProps): React.ReactElement {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const isMobile = useIsMobile()

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setExpandedId(null)
      onOpenChange(next)
    },
    [onOpenChange]
  )

  const handleToggle = React.useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id))
  }, [])

  return (
    <Drawer
      onOpenChange={handleOpenChange}
      open={open}
      position={isMobile ? "bottom" : "right"}
    >
      <DrawerPopup showBar>
        <DrawerHeader>
          <DrawerTitle>Proofs</DrawerTitle>
          <DrawerDescription>
            Eligibility proofs generated during this session.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="flex flex-col gap-2" hideScrollbar>
          {proofs.length === 0 ? (
            <EmptyState />
          ) : (
            proofs.map((proof) => (
              <ProofRow
                expanded={expandedId === proof.id}
                key={proof.id}
                onToggle={handleToggle}
                proof={proof}
              />
            ))
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/16 px-4 py-8 text-center text-sm text-muted-foreground">
      <ShieldCheckIcon aria-hidden="true" className="size-6 opacity-60" />
      <span>No proofs generated yet.</span>
      <span className="text-xs">
        Complete the verification step in a borrow flow to record a proof.
      </span>
    </div>
  )
}

function ProofRow({
  expanded,
  onToggle,
  proof,
}: {
  expanded: boolean
  onToggle: (id: string) => void
  proof: BorrowEligibilityProof
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background text-sm transition-colors",
        expanded && "border-border/80 bg-muted/16"
      )}
    >
      <button
        aria-expanded={expanded}
        aria-label={
          expanded ? `Collapse proof ${proof.id}` : `Expand proof ${proof.id}`
        }
        className="flex flex-col gap-1 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => onToggle(proof.id)}
        type="button"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{proof.claim}</span>
          <div className="flex items-center gap-2">
            <Badge
              variant={proof.status === "Verified" ? "default" : "destructive"}
            >
              {proof.status}
            </Badge>
            {expanded ? (
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            ) : (
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span className="font-mono truncate">
            <PrivateValue>{proof.id}</PrivateValue>
          </span>
          <span>Market: {proof.publicInputs.market}</span>
          <span>
            HF ≥ {proof.publicInputs.healthFactorMin} · LTV{" "}
            {proof.publicInputs.maxLtv}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/72">
            Expires {formatTimestamp(proof.expiresAt)}
          </span>
        </div>
      </button>

      {expanded ? <ProofDetails proof={proof} /> : null}
    </div>
  )
}

function ProofDetails({
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

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      try {
        await navigator.clipboard.writeText(proof.id)
        setCopied(true)
      } catch {
        setCopied(false)
      }
    },
    [proof.id]
  )

  const expiresAt = new Date(proof.expiresAt)
  const relativeExpiry = formatRelativeExpiry(expiresAt)

  return (
    <div className="flex flex-col gap-3 border-t bg-background/64 px-3 pt-3 pb-3 text-xs">
      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Proof id</span>
        <div className="flex items-start gap-2 rounded-md border bg-background p-2">
          <PrivateValue className="flex-1 font-mono text-xs break-all">
            {proof.id}
          </PrivateValue>
          <Button
            aria-label={copied ? "Proof id copied" : "Copy proof id"}
            onClick={handleCopy}
            size="icon-sm"
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
      </section>

      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Public inputs</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2">
          <dt className="text-muted-foreground">Market</dt>
          <dd className="text-right font-medium">
            {proof.publicInputs.market}
          </dd>
          <dt className="text-muted-foreground">Health factor min</dt>
          <dd className="text-right font-medium">
            {proof.publicInputs.healthFactorMin}
          </dd>
          <dt className="text-muted-foreground">Max LTV</dt>
          <dd className="text-right font-medium">
            {proof.publicInputs.maxLtv}
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Expiry</span>
        <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
          <span>{formatTimestamp(proof.expiresAt)}</span>
          <span className="text-muted-foreground">{relativeExpiry}</span>
        </div>
      </section>
    </div>
  )
}

function formatRelativeExpiry(expiresAt: Date): string {
  const diff = expiresAt.getTime() - Date.now()
  const past = diff < 0
  const seconds = Math.abs(Math.round(diff / 1_000))

  if (seconds < 60) {
    return past ? `${seconds}s ago` : `in ${seconds}s`
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return past ? `${minutes}m ago` : `in ${minutes}m`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 48) {
    return past ? `${hours}h ago` : `in ${hours}h`
  }

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
