"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import { MenuCheckboxItem } from "@/components/ui/menu"

export function ThemeModeMenuItem(): React.ReactElement {
  const { resolvedTheme, setTheme } = useTheme()
  const isDarkMode = resolvedTheme === "dark"
  const Icon = isDarkMode ? MoonIcon : SunIcon

  const handleCheckedChange = React.useCallback(
    (checked: boolean) => {
      if (checked) {
        setTheme("dark")
        return
      }

      setTheme("light")
    },
    [setTheme]
  )

  return (
    <MenuCheckboxItem
      checked={isDarkMode}
      onCheckedChange={handleCheckedChange}
      variant="switch"
    >
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 opacity-80" />
        Dark mode
      </span>
    </MenuCheckboxItem>
  )
}
