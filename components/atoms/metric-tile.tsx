import type * as React from "react"

type MetricTileProps = {
  label: string
  value: string
}

export function MetricTile({
  label,
  value,
}: MetricTileProps): React.ReactElement {
  return (
    <div className="rounded-md border bg-muted/48 p-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}
