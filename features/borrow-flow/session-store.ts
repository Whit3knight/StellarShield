import * as React from "react"

import type { BorrowEligibilityProof } from "@/features/proofs"

import { appendBorrowActivity } from "./activities"
import type { BorrowActivity } from "./types"

const ACTIVITY_HISTORY_CAP = 50
const PROOF_HISTORY_CAP = 50
const STORAGE_KEY = "stellar-shield:borrow-session"
const CHANGE_EVENT = "stellar-shield:borrow-session-change"

type BorrowSessionState = {
  activities: BorrowActivity[]
  proofs: BorrowEligibilityProof[]
}

const EMPTY_STATE: BorrowSessionState = {
  activities: [],
  proofs: [],
}

function isBorrowSessionState(value: unknown): value is BorrowSessionState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<BorrowSessionState>

  return (
    Array.isArray(candidate.activities) && Array.isArray(candidate.proofs)
  )
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

    return {
      activities: parsed.activities.slice(0, ACTIVITY_HISTORY_CAP),
      proofs: parsed.proofs.slice(0, PROOF_HISTORY_CAP),
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
  appendActivity(activity: BorrowActivity): void {
    const merged = appendBorrowActivity(currentState.activities, activity)

    if (merged === currentState.activities) return

    const nextActivities = merged.slice(0, ACTIVITY_HISTORY_CAP)

    commit({ ...currentState, activities: nextActivities })
  },
  appendProof(proof: BorrowEligibilityProof): void {
    if (currentState.proofs.some((existing) => existing.id === proof.id)) {
      return
    }

    const nextProofs = [proof, ...currentState.proofs].slice(
      0,
      PROOF_HISTORY_CAP
    )

    commit({ ...currentState, proofs: nextProofs })
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
  ACTIVITY_HISTORY_CAP,
  PROOF_HISTORY_CAP,
}
