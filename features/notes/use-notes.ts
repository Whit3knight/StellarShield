"use client"

import * as React from "react"

import { snapshotLiveNotes, subscribeNotes } from "./note-store"
import type { ShieldedNote } from "./note"

/**
 * React hook wrapping the module-level note cache. Consumers rerender
 * when the notes scanner rediscovers or updates notes. Spent
 * tombstones are filtered out — they exist only for Merkle rebuilds.
 */
export function useNotes(): ShieldedNote[] {
  return React.useSyncExternalStore(
    subscribeNotes,
    snapshotLiveNotes,
    snapshotLiveNotes
  )
}
