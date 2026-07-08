import type * as React from "react"

import { PrivateValue } from "./private-value"

type DetailRowProps = {
  label: string
  privateValue?: boolean
  value: string
}

export function DetailRow({
  label,
  privateValue = false,
  value,
}: DetailRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      {privateValue ? (
        <PrivateValue className="font-medium">{value}</PrivateValue>
      ) : (
        <span className="font-medium">{value}</span>
      )}
    </div>
  )
}
