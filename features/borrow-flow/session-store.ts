import * as React from "react"

import type { BorrowEligibilityProof } from "@/features/proofs"

import { appendBorrowActivity } from "./activities"
import type { BorrowActivity } from "./types"

const PROOF_HISTORY_CAP = 50

type BorrowSessionState = {
  activities: BorrowActivity[]
  proofs: BorrowEligibilityProof[]
}

const EMPTY_STATE: BorrowSessionState = {
  activities: [],
  proofs: [],
}

let currentState: BorrowSessionState = EMPTY_STATE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): BorrowSessionState {
  return currentState
}

function getServerSnapshot(): BorrowSessionState {
  return EMPTY_STATE
}

export const borrowSession = {
  appendActivity(activity: BorrowActivity): void {
    const nextActivities = appendBorrowActivity(currentState.activities, activity)

    if (nextActivities === currentState.activities) return

    currentState = { ...currentState, activities: nextActivities }
    emit()
  },
  appendProof(proof: BorrowEligibilityProof): void {
    if (currentState.proofs.some((existing) => existing.id === proof.id)) {
      return
    }

    const nextProofs = [proof, ...currentState.proofs].slice(
      0,
      PROOF_HISTORY_CAP
    )

    currentState = { ...currentState, proofs: nextProofs }
    emit()
  },
  reset(): void {
    currentState = EMPTY_STATE
    emit()
  },
  getSnapshot,
  subscribe,
}

export function useBorrowSession(): BorrowSessionState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
