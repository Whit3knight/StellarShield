// Client-side cache of the local shielded activity log. Mirrors
// note-store.ts's shape (module cache + subscribers + per-(contract,
// account) localStorage) for the same reload-survival reason, but
// simpler: activity has no "spent" state and no secret material (no
// `sk`), just public facts already visible to anyone reading this
// account's chain history — so unlike notes, losing it costs nothing
// and it never needs the account-sweep `resetNotes` does.

import {
  deserializeActivity,
  serializeActivity,
  type SerializedActivity,
  type ShieldedActivity,
} from "./activity"

const KEY_PREFIX = "stellar-shield:activity:v1:"

let cache: ShieldedActivity[] = []
const listeners = new Set<() => void>()
let storageKey: string | null = null

export function configureActivityPersistence(
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

function readPersisted(key: string): ShieldedActivity[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ShieldedActivity[] = []
    for (const row of parsed as SerializedActivity[]) {
      const activity = deserializeActivity(row)
      if (activity) out.push(activity)
    }
    return out
  } catch {
    return []
  }
}

function persist(): void {
  if (storageKey === null || typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(cache.map(serializeActivity))
    )
  } catch {
    // Quota / privacy-mode failures degrade to in-memory behavior.
  }
}

export function snapshotActivities(): ShieldedActivity[] {
  return cache
}

export function replaceActivities(next: ShieldedActivity[]): void {
  cache = next
  persist()
  for (const listener of listeners) listener()
}

export function subscribeActivities(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetActivities(): void {
  if (typeof window !== "undefined" && storageKey !== null) {
    window.localStorage.removeItem(storageKey)
  }
  storageKey = null
  cache = []
  for (const listener of listeners) listener()
}
