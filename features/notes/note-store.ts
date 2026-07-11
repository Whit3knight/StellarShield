// Client-side inventory of shielded notes the current wallet owns.
// Populated by scanning deposit / borrow / repay events on the
// deployed shielded pool contract, attempting to decrypt each memo
// with the wallet's shielded identity secret.
//
// The store is a module-level cache + subscriber list, mirroring the
// pattern in `features/markets/price-cache.ts`.

import type { ShieldedNote } from "./note"

let cache: ShieldedNote[] = []
const listeners = new Set<() => void>()

export function snapshotNotes(): ShieldedNote[] {
  return cache
}

export function replaceNotes(next: ShieldedNote[]): void {
  cache = next
  for (const listener of listeners) listener()
}

export function upsertNote(note: ShieldedNote): void {
  const existingIndex = cache.findIndex(
    (candidate) =>
      candidate.tree === note.tree && candidate.index === note.index
  )
  if (existingIndex >= 0) {
    if (notesEqual(cache[existingIndex], note)) return
    const next = cache.slice()
    next[existingIndex] = note
    cache = next
  } else {
    cache = [note, ...cache]
  }
  for (const listener of listeners) listener()
}

export function subscribeNotes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetNotes(): void {
  cache = []
  for (const listener of listeners) listener()
}

/**
 * Group notes by (tree, asset). Handy for showing the "Shielded
 * balance" tile: sum of notes × denomination per asset.
 */
export function groupByAsset(
  notes: ShieldedNote[]
): Record<string, ShieldedNote[]> {
  const groups: Record<string, ShieldedNote[]> = {}
  for (const note of notes) {
    const key = `${note.tree}:${note.asset}`
    const list = groups[key] ?? []
    list.push(note)
    groups[key] = list
  }
  return groups
}

function notesEqual(a: ShieldedNote, b: ShieldedNote): boolean {
  return (
    a.tree === b.tree &&
    a.index === b.index &&
    a.asset === b.asset &&
    a.amount === b.amount &&
    a.salt === b.salt &&
    a.sk === b.sk
  )
}
