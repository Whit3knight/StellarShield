"use client"

import { InfoIcon } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { InputGroupAddon } from "@/components/ui/input-group"
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover"

type InputHelpAddonProps = {
  children: React.ReactNode
}

export function InputHelpAddon({
  children,
}: InputHelpAddonProps): React.ReactElement {
  return (
    <InputGroupAddon align="inline-end">
      <Popover>
        <PopoverTrigger
          openOnHover
          render={
            <Button aria-label="More info" size="icon-xs" variant="ghost" />
          }
        >
          <InfoIcon />
        </PopoverTrigger>
        <PopoverPopup side="top" tooltipStyle>
          <p>{children}</p>
        </PopoverPopup>
      </Popover>
    </InputGroupAddon>
  )
}
