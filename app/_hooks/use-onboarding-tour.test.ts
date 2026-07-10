import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __TEST__,
  markOnboardingTourSeen,
  resetOnboardingTour,
  setOnboardingTourSeen,
  subscribeToOpenTour,
} from "./use-onboarding-tour"

beforeEach(() => {
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
})

afterEach(() => {
  window.localStorage.removeItem(__TEST__.STORAGE_KEY)
})

describe("onboarding tour storage", () => {
  it("marks and reads the seen flag", () => {
    markOnboardingTourSeen()

    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBe("true")
  })

  it("resets clears the seen flag", () => {
    markOnboardingTourSeen()
    resetOnboardingTour()

    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBeNull()
  })

  it("resetOnboardingTour fires the open event", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToOpenTour(listener)

    resetOnboardingTour()

    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it("setOnboardingTourSeen(false) removes the key", () => {
    markOnboardingTourSeen()
    setOnboardingTourSeen(false)

    expect(window.localStorage.getItem(__TEST__.STORAGE_KEY)).toBeNull()
  })
})
