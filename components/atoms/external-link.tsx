import { ArrowUpRightIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

type ExternalLinkProps = Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "target" | "rel"
> & {
  children: React.ReactNode
  href: string
}

export function ExternalLink({
  children,
  className,
  href,
  ...props
}: ExternalLinkProps): React.ReactElement {
  return (
    <a
      className={cn(
        "inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
      <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
    </a>
  )
}
