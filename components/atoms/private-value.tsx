import type * as React from "react"

type PrivateValueProps = {
  children: React.ReactNode
  className?: string
  mask?: string
}

export function PrivateValue({
  children,
  className,
  mask = "••••••",
}: PrivateValueProps): React.ReactElement {
  return (
    <span className={className} data-private-value>
      <span data-private-clear>{children}</span>
      <span aria-label="Hidden for privacy" data-private-mask>
        {mask}
      </span>
    </span>
  )
}
