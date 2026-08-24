"use client"

import * as React from "react"

import { snapshotActivities, subscribeActivities } from "./activity-store"
import type { ShieldedActivity } from "./activity"

/**
 * React hook wrapping the module-level activity cache. Consumers
 * rerender whenever the notes scanner discovers new activity.
 */
export function useActivities(): ShieldedActivity[] {
  return React.useSyncExternalStore(
    subscribeActivities,
    snapshotActivities,
    snapshotActivities
  )
}
