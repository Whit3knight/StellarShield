"use client"

import * as React from "react"

import { appPreferenceKeys } from "@/app/_constants/preferences"

const privacyModeChangeEvent = "stellar-shield:privacy-mode-change"

function readStoredPrivacyMode(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(appPreferenceKeys.privacyMode) === "true"
}

function subscribeToPrivacyMode(callback: () => void): () => void {
  window.addEventListener("storage", callback)
  window.addEventListener(privacyModeChangeEvent, callback)

  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(privacyModeChangeEvent, callback)
  }
}

export function applyPrivacyModeAttribute(enabled: boolean): void {
  if (enabled) {
    document.documentElement.dataset.privacyMode = "true"
    return
  }

  delete document.documentElement.dataset.privacyMode
}

export function setPrivacyMode(enabled: boolean): void {
  if (enabled) {
    window.localStorage.setItem(appPreferenceKeys.privacyMode, "true")
  } else {
    window.localStorage.removeItem(appPreferenceKeys.privacyMode)
  }

  applyPrivacyModeAttribute(enabled)
  window.dispatchEvent(new Event(privacyModeChangeEvent))
}

export function usePrivacyMode(): boolean {
  return React.useSyncExternalStore(
    subscribeToPrivacyMode,
    readStoredPrivacyMode,
    () => false
  )
}
