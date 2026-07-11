"use client"

import * as React from "react"

import { snapshotNotes, subscribeNotes } from "./note-store"
import type { ShieldedNote } from "./note"

/**
 * React hook wrapping the module-level note cache. Consumers rerender
 * when the notes scanner rediscovers or updates notes.
 */
export function useNotes(): ShieldedNote[] {
  return React.useSyncExternalStore(
    subscribeNotes,
    snapshotNotes,
    snapshotNotes
  )
}
