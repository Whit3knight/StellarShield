"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import { useShieldedPoolContext } from "@/features/shielded-pool/shielded-pool-provider"

import {
  backupBundleToDownload,
  decodeNotesBackup,
  encodeNotesBackup,
  parseBackupJson,
  restoreNotesBackup,
} from "./backup"
import {
  countUnbackedNotes,
  markBackedUp,
  subscribeBackupState,
} from "./backup-state"
import { snapshotNotes, subscribeNotes } from "./note-store"
import { legacyIdentityFromAddress } from "./use-shielded-identity"

type UseNotesBackupResult = {
  canBackup: boolean
  unbackedCount: number
  exportNotes: () => void
  importNotes: (file: File) => Promise<void>
}

function subscribeStale(listener: () => void): () => void {
  const offNotes = subscribeNotes(listener)
  const offBackup = subscribeBackupState(listener)
  return () => {
    offNotes()
    offBackup()
  }
}

/**
 * Encapsulates the export/import backup flow so any surface (nav
 * menu, positions drawer, dialog) can trigger it without re-writing
 * the identity + encoding plumbing. Silent no-op when the shielded
 * identity isn't ready yet (wallet not connected).
 */
export function useNotesBackup(): UseNotesBackupResult {
  const { account, identity } = useShieldedPoolContext()

  const unbackedCount = React.useSyncExternalStore(
    subscribeStale,
    () => (account ? countUnbackedNotes(account, snapshotNotes()) : 0),
    () => 0
  )

  const exportNotes = React.useCallback(() => {
    if (!identity) {
      toastManager.add({
        title: "Backup unavailable",
        description: "Connect a wallet before exporting notes.",
        type: "info",
        timeout: 4_000,
      })
      return
    }
    try {
      const notes = snapshotNotes()
      if (notes.length === 0) {
        toastManager.add({
          title: "Nothing to back up",
          description: "No shielded notes in local inventory yet.",
          type: "info",
          timeout: 4_000,
        })
        return
      }
      const bundle = encodeNotesBackup(
        notes,
        identity,
        Math.floor(Date.now() / 1000)
      )
      const download = backupBundleToDownload(bundle)
      const blob = new Blob([download.body], { type: download.mime })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = download.filename
      anchor.click()
      URL.revokeObjectURL(url)
      if (account) markBackedUp(account, notes)
      toastManager.add({
        title: "Backup exported",
        description: `${notes.length} note${notes.length === 1 ? "" : "s"} sealed to ${download.filename}.`,
        type: "success",
        timeout: 5_000,
      })
    } catch (cause) {
      toastManager.add({
        title: "Backup export failed",
        description: cause instanceof Error ? cause.message : "Unknown error.",
        type: "error",
        timeout: 6_000,
      })
    }
  }, [account, identity])

  const importNotes = React.useCallback(
    async (file: File) => {
      if (!identity) {
        toastManager.add({
          title: "Backup unavailable",
          description: "Connect a wallet before importing notes.",
          type: "info",
          timeout: 4_000,
        })
        return
      }
      try {
        const raw = await file.text()
        const bundle = parseBackupJson(raw)
        let restored: ReturnType<typeof decodeNotesBackup>
        try {
          restored = decodeNotesBackup(bundle, identity)
        } catch (primaryError) {
          // Backups written before the R1 identity migration were sealed
          // under the address-derived key; retry with it before giving up.
          if (!account) throw primaryError
          const legacy = await legacyIdentityFromAddress(account)
          try {
            restored = decodeNotesBackup(bundle, legacy)
          } catch {
            throw primaryError
          }
        }
        restoreNotesBackup(restored)
        toastManager.add({
          title: "Backup imported",
          description: `${restored.length} note${restored.length === 1 ? "" : "s"} merged into inventory.`,
          type: "success",
          timeout: 5_000,
        })
      } catch (cause) {
        toastManager.add({
          title: "Backup import failed",
          description:
            cause instanceof Error
              ? cause.message
              : "File is not a valid backup.",
          type: "error",
          timeout: 6_000,
        })
      }
    },
    [account, identity]
  )

  return {
    canBackup: Boolean(identity),
    unbackedCount,
    exportNotes,
    importNotes,
  }
}
