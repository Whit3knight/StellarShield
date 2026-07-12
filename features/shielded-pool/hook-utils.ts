// Shared helpers for the shielded-pool hooks. Keeps toast lifecycle
// tracking + Freighter-rejection normalisation consistent so a bug in
// one hook doesn't have to be fixed six times.

import { toastManager } from "@/components/ui/toast"

/**
 * Mutable holder for the currently-active loading toast. Every hook
 * opens toasts sequentially (reconstruct → prove → sign); when one
 * completes it must close the previous. On error the outer catch must
 * close whichever one is still open — hence the tracker.
 */
export type ToastTracker = {
  set(id: string): void
  close(): void
}

export function createToastTracker(): ToastTracker {
  let current: string | null = null
  return {
    set(id) {
      if (current !== null) {
        try {
          toastManager.close(current)
        } catch {
          // already closed
        }
      }
      current = id
    },
    close() {
      if (current !== null) {
        try {
          toastManager.close(current)
        } catch {
          // already closed
        }
        current = null
      }
    },
  }
}

const FREIGHTER_REJECTION_HINTS = [
  "user declined",
  "user rejected",
  "user cancelled",
  "user canceled",
  "declined by user",
  "action canceled",
  "action cancelled",
  "not connected",
]

/**
 * Freighter (and every wallet we've integrated) throws a normal
 * Error when the user cancels the sign prompt. The message differs
 * across versions; match any of the known substrings, case-insensitively.
 */
export function isUserRejection(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? "")
  const normalised = message.toLowerCase()
  return FREIGHTER_REJECTION_HINTS.some((hint) => normalised.includes(hint))
}

/**
 * Normalise a caught error into `{ title, description }` for a toast.
 * User rejection collapses to a neutral "signing cancelled"; anything
 * else uses the raw message, falling back to a stable default when
 * empty.
 */
export function describeError(
  cause: unknown,
  fallbackTitle: string
): { title: string; description: string; rejected: boolean } {
  if (isUserRejection(cause)) {
    return {
      title: "Signing cancelled",
      description: "You dismissed the wallet prompt.",
      rejected: true,
    }
  }
  const description =
    cause instanceof Error && cause.message
      ? cause.message
      : `${fallbackTitle}.`
  return { title: fallbackTitle, description, rejected: false }
}
