"use client"

import { EyeIcon, EyeOffIcon } from "lucide-react"
import * as React from "react"

import { MenuCheckboxItem } from "@/components/ui/menu"
import {
  applyPrivacyModeAttribute,
  setPrivacyMode,
  usePrivacyMode,
} from "@/hooks/use-privacy-mode"

export function PrivacyModeMenuItem(): React.ReactElement {
  const isPrivacyMode = usePrivacyMode()
  const Icon = isPrivacyMode ? EyeOffIcon : EyeIcon

  React.useEffect(() => {
    applyPrivacyModeAttribute(isPrivacyMode)
  }, [isPrivacyMode])

  const handleCheckedChange = React.useCallback((checked: boolean) => {
    setPrivacyMode(checked)
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
