// Client-side inventory of shielded notes the current wallet owns.
// Populated by scanning deposit / borrow / repay events on the
// deployed shielded pool contract, attempting to decrypt each memo
// with the wallet's shielded identity.
//
// The store is a module-level cache + subscriber list, mirroring the
// pattern in `features/markets/price-cache.ts`. Once
// `configureNotePersistence` runs, every mutation is mirrored to
// localStorage so notes (including spent tombstones needed for Merkle
// tree rebuilds) survive a page reload even after the enabling chain
// events expire from RPC retention.
// ponytail: plaintext at rest; encrypt at rest before mainnet

import { isSpentNote, type ShieldedNote } from "./note"
import { deserializeNote, serializeNote, type SerializedNote } from "./note-serde"

const KEY_PREFIX = "stellar-shield:notes:v1:"

let cache: ShieldedNote[] = []
const listeners = new Set<() => void>()
let storageKey: string | null = null

/**
 * Point the store at a per-(contract, account) localStorage slot and
 * hydrate the cache from it. Safe to call repeatedly — same key is a
 * no-op so rescans don't clobber in-memory witnesses with the
 * witness-stripped persisted copy.
 */
export function configureNotePersistence(
  contractId: string,
  account: string
): void {
  if (typeof window === "undefined") return
  const key = `${KEY_PREFIX}${contractId}:${account}`
  if (key === storageKey) return
  storageKey = key
  cache = readPersisted(key)
  for (const listener of listeners) listener()
}

function readPersisted(key: string): ShieldedNote[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? (parsed as SerializedNote[]).map(deserializeNote)
      : []
  } catch {
    return []
  }
}

function persist(): void {
  if (storageKey === null || typeof window === "undefined") return
  try {
    // Witnesses are dropped: they dominate the payload, go stale on
    // every tree append, and spend paths recompute them per op.
    const rows = cache.map((note) => serializeNote({ ...note, witness: undefined }))
    window.localStorage.setItem(storageKey, JSON.stringify(rows))
  } catch {
    // Quota / privacy-mode failures degrade to in-memory behavior.
  }
}

export function snapshotNotes(): ShieldedNote[] {
  return cache
}

let liveView: ShieldedNote[] = []
let liveViewSource: ShieldedNote[] | null = null

/**
 * Unspent notes only — the view UI consumers want. Result is cached
 * per underlying cache reference so `useSyncExternalStore` sees a
 * stable snapshot between mutations.
 */
export function snapshotLiveNotes(): ShieldedNote[] {
  if (liveViewSource !== cache) {
    liveView = cache.filter((note) => !isSpentNote(note))
    liveViewSource = cache
  }
  return liveView
}

export function replaceNotes(next: ShieldedNote[]): void {
  cache = next
  persist()
  for (const listener of listeners) listener()
}

export function upsertNote(note: ShieldedNote): void {
  const existingIndex = cache.findIndex(
    (candidate) =>
      candidate.tree === note.tree &&
      candidate.index === note.index &&
      candidate.asset === note.asset
  )
  if (existingIndex >= 0) {
    if (notesEqual(cache[existingIndex], note)) return
    const next = cache.slice()
    next[existingIndex] = note
    cache = next
  } else {
    cache = [note, ...cache]
  }
  persist()
  for (const listener of listeners) listener()
}

export function subscribeNotes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Drop the in-memory cache and the localStorage slots it mirrors. Lossy:
 * a note's `salt` lives only here and inside its on-chain encrypted
 * memo, so recovery needs the enabling events to still be reachable.
 * The next `configureNotePersistence` rehydrates from an empty slot.
 *
 * Pass `account` to also sweep rows this session never pointed at: keys
 * are per-(contract, account), so redeployed contracts leave orphaned
 * rows behind and every row holds `sk` — the note spending key.
 *
 * ponytail: sweeps the named account only, like
 * `forgetShieldedIdentity`. Another wallet used in this browser profile
 * keeps its rows — drop the `endsWith` filter if a full wipe matters.
 */
export function resetNotes(account?: string): void {
  if (typeof window !== "undefined") {
    if (storageKey !== null) window.localStorage.removeItem(storageKey)
    if (account) {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(KEY_PREFIX) && key.endsWith(`:${account}`)) {
          window.localStorage.removeItem(key)
        }
      }
    }
  }
  storageKey = null
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
    a.sk === b.sk &&
    a.spent === b.spent
  )
}
