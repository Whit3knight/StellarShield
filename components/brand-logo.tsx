import type * as React from "react"

import { cn } from "@/lib/utils"

const logoMaskStyle = {
  mask: "url(/stellar-shield-black.svg) center / contain no-repeat",
  WebkitMask: "url(/stellar-shield-black.svg) center / contain no-repeat",
} satisfies React.CSSProperties

type BrandLogoProps = {
  className?: string
  iconClassName?: string
  showText?: boolean
}

export function BrandLogo({
  className,
  iconClassName,
  showText = true,
}: BrandLogoProps): React.ReactElement {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn("size-8 bg-foreground", iconClassName)}
        style={logoMaskStyle}
      />
      {showText ? (
        <span className="hidden font-semibold tracking-normal sm:inline">
          Stellar Shield
        </span>
      ) : null}
    </span>
  )
}
