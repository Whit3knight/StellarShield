import { beforeEach, describe, expect, it } from "vitest"

import { appPreferenceKeys } from "@/app/_constants/preferences"

import { applyPrivacyModeAttribute, setPrivacyMode } from "./use-privacy-mode"

describe("privacy mode", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.privacyMode
  })

  it("applies and removes the document privacy marker", () => {
    applyPrivacyModeAttribute(true)
    expect(document.documentElement.dataset.privacyMode).toBe("true")

    applyPrivacyModeAttribute(false)
    expect(document.documentElement.dataset.privacyMode).toBeUndefined()
  })

  it("persists privacy mode preference in local storage", () => {
    setPrivacyMode(true)
    expect(window.localStorage.getItem(appPreferenceKeys.privacyMode)).toBe(
      "true"
    )
    expect(document.documentElement.dataset.privacyMode).toBe("true")

    setPrivacyMode(false)
    expect(
      window.localStorage.getItem(appPreferenceKeys.privacyMode)
    ).toBeNull()
    expect(document.documentElement.dataset.privacyMode).toBeUndefined()
  })
})
