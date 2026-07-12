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
import { snapshotNotes } from "./note-store"

type UseNotesBackupResult = {
  canBackup: boolean
  exportNotes: () => void
  importNotes: (file: File) => Promise<void>
}

/**
 * Encapsulates the export/import backup flow so any surface (nav
 * menu, positions drawer, dialog) can trigger it without re-writing
 * the identity + encoding plumbing. Silent no-op when the shielded
 * identity isn't ready yet (wallet not connected).
 */
export function useNotesBackup(): UseNotesBackupResult {
  const { identity } = useShieldedPoolContext()

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
  }, [identity])

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
        const restored = decodeNotesBackup(bundle, identity)
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
    [identity]
  )

  return {
    canBackup: Boolean(identity),
    exportNotes,
    importNotes,
  }
}
