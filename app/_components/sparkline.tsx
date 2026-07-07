import type * as React from "react"

import type { ChartPoint } from "../_constants/dashboard"

function createLinePath(points: ChartPoint[], width: number, height: number) {
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = points.length > 1 ? width / (points.length - 1) : 0

  return points
    .map((point, index) => {
      const x = index * step
      const y = height - ((point.value - min) / range) * height

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

export function Sparkline({
  className,
  label,
  points,
}: {
  className?: string
  label: string
  points: ChartPoint[]
}): React.ReactElement {
  const width = 280
  const height = 92
  const linePath = createLinePath(points, width, height)
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg
      aria-label={label}
      className={className}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path className="fill-current opacity-10" d={areaPath} />
      <path
        className="fill-none stroke-current"
        d={linePath}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      {points.map((point, index) => {
        if (index !== points.length - 1) {
          return null
        }

        const values = points.map((item) => item.value)
        const min = Math.min(...values)
        const max = Math.max(...values)
        const range = max - min || 1
        const x = width
        const y = height - ((point.value - min) / range) * height

        return (
          <circle
            className="fill-background stroke-current"
            cx={x}
            cy={y}
            key={point.label}
            r="4"
            strokeWidth="2"
          />
        )
      })}
    </svg>
  )
}
