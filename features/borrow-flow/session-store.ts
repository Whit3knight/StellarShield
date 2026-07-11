import * as React from "react"

import type { BorrowEligibilityProof } from "@/features/proofs"

const PROOF_HISTORY_CAP = 50
const STORAGE_KEY = "stellar-shield:borrow-session"
const CHANGE_EVENT = "stellar-shield:borrow-session-change"

// Session store used to persist positions + activities + proofs when
// the app ran on the mock adapter. Positions and activities now come
// from the on-chain `positions_by_account` view and merged event
// derivation, so only proofs remain: the chain stores `proof_id`
// but not the proof bytes, and the drawer needs the local copy to
// display metadata and (later) repay-flow inputs.
type BorrowSessionState = {
  proofs: BorrowEligibilityProof[]
}

const EMPTY_STATE: BorrowSessionState = { proofs: [] }

function isBorrowSessionState(
  value: unknown
): value is { proofs?: unknown } {
  return Boolean(value && typeof value === "object")
}

function readStored(): BorrowSessionState {
  if (typeof window === "undefined") return EMPTY_STATE

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE

    const parsed = JSON.parse(raw)
    if (!isBorrowSessionState(parsed)) {
      window.localStorage.removeItem(STORAGE_KEY)
      return EMPTY_STATE
    }

    const proofsRaw = Array.isArray(parsed.proofs) ? parsed.proofs : []
    return {
      proofs: (proofsRaw as BorrowEligibilityProof[])
        .slice(0, PROOF_HISTORY_CAP)
        .map((proof) => ({
          ...proof,
          generatedAt: proof.generatedAt ?? proof.expiresAt,
        })),
    }
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore write failure
    }
    return EMPTY_STATE
  }
}

function setStored(next: BorrowSessionState): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked — session still lives in memory.
  }
}

let currentState: BorrowSessionState = readStored()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function handleExternalChange(): void {
  currentState = readStored()
  emit()
}

let externalListenersAttached = false

function ensureExternalListeners(): void {
  if (externalListenersAttached || typeof window === "undefined") return

  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== STORAGE_KEY) return
    handleExternalChange()
  })
  window.addEventListener(CHANGE_EVENT, handleExternalChange)
  externalListenersAttached = true
}

function subscribe(listener: () => void): () => void {
  ensureExternalListeners()
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

function commit(next: BorrowSessionState): void {
  currentState = next
  setStored(next)
  emit()
}

export const borrowSession = {
  appendProof(proof: BorrowEligibilityProof): void {
    if (currentState.proofs.some((existing) => existing.id === proof.id)) return

    const nextProofs = [proof, ...currentState.proofs].slice(
      0,
      PROOF_HISTORY_CAP
    )
    commit({ proofs: nextProofs })
  },
  reset(): void {
    commit(EMPTY_STATE)
  },
  getSnapshot,
  subscribe,
}

export function useBorrowSession(): BorrowSessionState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export const __TEST__ = {
  STORAGE_KEY,
  CHANGE_EVENT,
  PROOF_HISTORY_CAP,
}
