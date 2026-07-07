import type * as React from "react"

import type { ChartPoint } from "../_constants/dashboard"

type ChartBounds = {
  min: number
  range: number
  step: number
}

function getChartBounds(points: ChartPoint[], width: number): ChartBounds {
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return {
    min,
    range: max - min || 1,
    step: points.length > 1 ? width / (points.length - 1) : 0,
  }
}

function getPointPosition(
  point: ChartPoint,
  index: number,
  bounds: ChartBounds,
  height: number
): { x: number; y: number } {
  return {
    x: index * bounds.step,
    y: height - ((point.value - bounds.min) / bounds.range) * height,
  }
}

function createLinePath(
  points: ChartPoint[],
  bounds: ChartBounds,
  height: number
): string {
  return points
    .map((point, index) => {
      const { x, y } = getPointPosition(point, index, bounds, height)

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

  if (points.length === 0) {
    return (
      <svg
        aria-label={label}
        className={className}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      />
    )
  }

  const bounds = getChartBounds(points, width)
  const linePath = createLinePath(points, bounds, height)
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`
  const lastPoint = points.at(-1)
  const lastPointPosition = lastPoint
    ? getPointPosition(lastPoint, points.length - 1, bounds, height)
    : null

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
      {lastPointPosition ? (
        <circle
          className="fill-background stroke-current"
          cx={lastPointPosition.x}
          cy={lastPointPosition.y}
          r="4"
          strokeWidth="2"
        />
      ) : null}
    </svg>
  )
}
