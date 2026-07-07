"use client"

import { EyeIcon, EyeOffIcon } from "lucide-react"
import * as React from "react"

import { MenuCheckboxItem } from "@/components/ui/menu"

import { appPreferenceKeys } from "../_constants/preferences"

const privacyModeChangeEvent = "stellar-shield:privacy-mode-change"

function applyPrivacyMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.dataset.privacyMode = "true"
    return
  }

  delete document.documentElement.dataset.privacyMode
}

function readStoredPrivacyMode() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(appPreferenceKeys.privacyMode) === "true"
}

function writeStoredPrivacyMode(enabled: boolean) {
  if (enabled) {
    window.localStorage.setItem(appPreferenceKeys.privacyMode, "true")
    return
  }

  window.localStorage.removeItem(appPreferenceKeys.privacyMode)
}

function subscribeToPrivacyMode(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(privacyModeChangeEvent, callback)

  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(privacyModeChangeEvent, callback)
  }
}

export function PrivacyModeMenuItem(): React.ReactElement {
  const isPrivacyMode = React.useSyncExternalStore(
    subscribeToPrivacyMode,
    readStoredPrivacyMode,
    () => false
  )
  const Icon = isPrivacyMode ? EyeOffIcon : EyeIcon

  React.useEffect(() => {
    applyPrivacyMode(isPrivacyMode)
  }, [isPrivacyMode])

  const handleCheckedChange = React.useCallback((checked: boolean) => {
    writeStoredPrivacyMode(checked)
    applyPrivacyMode(checked)
    window.dispatchEvent(new Event(privacyModeChangeEvent))
  }, [])

  return (
    <MenuCheckboxItem
      checked={isPrivacyMode}
      onCheckedChange={handleCheckedChange}
      variant="switch"
    >
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 opacity-80" />
        Privacy mode
      </span>
    </MenuCheckboxItem>
  )
}
