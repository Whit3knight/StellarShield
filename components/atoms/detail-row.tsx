import type * as React from "react"

type DetailRowProps = {
  label: string
  value: string
}

export function DetailRow({
  label,
  value,
}: DetailRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
