"use client"

import { ShieldCheckIcon } from "lucide-react"
import type * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer"
import type { BorrowEligibilityProof } from "@/features/proofs"

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
  return (
    <Drawer onOpenChange={onOpenChange} open={open} position="right">
      <DrawerPopup>
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
            proofs.map((proof) => <ProofRow key={proof.id} proof={proof} />)
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
  proof,
}: {
  proof: BorrowEligibilityProof
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">{proof.claim}</span>
        <Badge variant={proof.status === "Verified" ? "default" : "destructive"}>
          {proof.status}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span className="font-mono break-all">
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
    </div>
  )
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
