"use client"

import * as React from "react"

import { appPreferenceKeys } from "@/app/_constants/preferences"

const CHANGE_EVENT = "stellar-shield:onboarding-tour-change"
const OPEN_EVENT = "stellar-shield:onboarding-tour-open"

function readStored(): boolean {
  if (typeof window === "undefined") return true

  try {
    return (
      window.localStorage.getItem(appPreferenceKeys.onboardingTourSeen) ===
      "true"
    )
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener)
  window.addEventListener(CHANGE_EVENT, listener)

  return () => {
    window.removeEventListener("storage", listener)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}

export function setOnboardingTourSeen(seen: boolean): void {
  if (typeof window === "undefined") return

  try {
    if (seen) {
      window.localStorage.setItem(
        appPreferenceKeys.onboardingTourSeen,
        "true"
      )
    } else {
      window.localStorage.removeItem(appPreferenceKeys.onboardingTourSeen)
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // storage blocked; fall through
  }
}

export function markOnboardingTourSeen(): void {
  setOnboardingTourSeen(true)
}

export function resetOnboardingTour(): void {
  setOnboardingTourSeen(false)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_EVENT))
  }
}

export function subscribeToOpenTour(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined

  window.addEventListener(OPEN_EVENT, listener)

  return () => {
    window.removeEventListener(OPEN_EVENT, listener)
  }
}

export function useOnboardingTourSeen(): boolean {
  return React.useSyncExternalStore(subscribe, readStored, () => true)
}

export const __TEST__ = {
  CHANGE_EVENT,
  OPEN_EVENT,
  STORAGE_KEY: appPreferenceKeys.onboardingTourSeen,
}
