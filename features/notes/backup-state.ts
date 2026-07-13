import type { ShieldedNote } from "./note"

// Tracks which notes the user has exported to a backup file, per wallet,
// so the UI can nudge when live notes have never been backed up. Recovery
// from chain events is bounded by the RPC retention window (~14h), so an
// un-backed note older than that window can become unrecoverable — this is
// the honest counter to "no backup needed".

const storageKey = (account: string): string =>
  `stellar-shield:backup-keys:${account}`

const noteKey = (note: Pick<ShieldedNote, "asset" | "tree" | "index">): string =>
  `${note.asset}:${note.tree}:${note.index}`

const listeners = new Set<() => void>()

function readKeys(account: string): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(account))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? new Set(parsed.filter((k): k is string => typeof k === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

/** Record the given notes as backed up for this account. */
export function markBackedUp(account: string, notes: ShieldedNote[]): void {
  if (typeof window === "undefined") return
  const keys = notes.map(noteKey)
  window.localStorage.setItem(storageKey(account), JSON.stringify(keys))
  for (const listener of listeners) listener()
}

/** Count live notes whose key is not in the last backup for this account. */
export function countUnbackedNotes(
  account: string,
  notes: ShieldedNote[]
): number {
  const backed = readKeys(account)
  return notes.reduce((n, note) => n + (backed.has(noteKey(note)) ? 0 : 1), 0)
}

export function subscribeBackupState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
