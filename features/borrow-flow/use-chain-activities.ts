"use client"

import * as React from "react"

import type { BorrowEligibilityProof } from "@/features/proofs"
import type { ChainBorrowReceipt } from "@/features/protocol"

import { deriveActivities } from "./chain-activities"
import type { BorrowActivity } from "./types"

export function useMergedActivities({
  chainReceipts,
  proofs,
  sessionActivities,
}: {
  chainReceipts: ChainBorrowReceipt[]
  proofs: BorrowEligibilityProof[]
  sessionActivities: BorrowActivity[]
}): BorrowActivity[] {
  return React.useMemo(
    () => deriveActivities({ chainReceipts, proofs, sessionActivities }),
    [chainReceipts, proofs, sessionActivities]
  )
}
