"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type RateTrendPoint = {
  label: string
  value: number
}

export type RateTrendTone =
  "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5"

type ChartBounds = {
  max: number
  min: number
  range: number
}

type ChartPosition = RateTrendPoint & {
  x: number
  y: number
}

const CHART_WIDTH = 360
const CHART_HEIGHT = 176
const PADDING = {
  bottom: 28,
  left: 34,
  right: 42,
  top: 14,
}
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

const toneClassNames: Record<RateTrendTone, string> = {
  "chart-1": "text-chart-1",
  "chart-2": "text-chart-2",
  "chart-3": "text-chart-3",
  "chart-4": "text-chart-4",
  "chart-5": "text-chart-5",
}

function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`
}

function getChartBounds(points: RateTrendPoint[]): ChartBounds {
  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const valueRange = maxValue - minValue || 1
  const padding = valueRange * 0.18
  const min = Math.max(0, minValue - padding)
  const max = maxValue + padding

  return {
    max,
    min,
    range: max - min || 1,
  }
}

function getPointPosition(
  point: RateTrendPoint,
  index: number,
  bounds: ChartBounds,
  pointCount: number
): ChartPosition {
  const x =
    PADDING.left +
    (pointCount > 1 ? (index / (pointCount - 1)) * PLOT_WIDTH : 0)
  const y =
    PADDING.top +
    PLOT_HEIGHT -
    ((point.value - bounds.min) / bounds.range) * PLOT_HEIGHT

  return {
    ...point,
    x,
    y,
  }
}

function createSmoothPath(points: ChartPosition[]): string {
  if (points.length === 0) {
    return ""
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  }

  return points.slice(1).reduce(
    (path, point, index) => {
      const previous = points[index]
      const controlX = (previous.x + point.x) / 2

      return `${path} C ${controlX.toFixed(2)} ${previous.y.toFixed(
        2
      )}, ${controlX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(
        2
      )} ${point.y.toFixed(2)}`
    },
    `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  )
}

function getGridLines(bounds: ChartBounds): { label: string; y: number }[] {
  return [0, 0.5, 1].map((ratio) => {
    const value = bounds.max - bounds.range * ratio

    return {
      label: formatPercent(value),
      y: PADDING.top + PLOT_HEIGHT * ratio,
    }
  })
}

function getTrendLabel(points: RateTrendPoint[]): string {
  if (points.length < 2) {
    return "0.0% 7D"
  }

  const change = points[points.length - 1].value - points[0].value
  const prefix = change > 0 ? "+" : ""

  return `${prefix}${formatPercent(change)} 7D`
}

function getActiveIndex(
  event: React.PointerEvent<SVGSVGElement>,
  pointCount: number
): number {
  const rect = event.currentTarget.getBoundingClientRect()
  const relativeX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH
  const chartX = Math.min(
    CHART_WIDTH - PADDING.right,
    Math.max(PADDING.left, relativeX)
  )
  const ratio = (chartX - PADDING.left) / PLOT_WIDTH

  return Math.round(ratio * (pointCount - 1))
}

export function RateTrendChart({
  className,
  label,
  points,
  tone = "chart-2",
  value,
}: {
  className?: string
  label: string
  points: RateTrendPoint[]
  tone?: RateTrendTone
  value: string
}): React.ReactElement {
  const gradientId = React.useId().replaceAll(":", "")
  const defaultIndex = Math.max(0, points.length - 1)
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  if (points.length === 0) {
    return (
      <div className={cn("rounded-lg p-4", className)}>
        <div className="h-48 rounded-md bg-muted" />
      </div>
    )
  }

  const safeActiveIndex = Math.min(
    hoveredIndex ?? defaultIndex,
    points.length - 1
  )
  const bounds = getChartBounds(points)
  const positions = points.map((point, index) =>
    getPointPosition(point, index, bounds, points.length)
  )
  const activePoint = positions[safeActiveIndex]
  const linePath = createSmoothPath(positions)
  const areaPath = `${linePath} L ${
    positions[positions.length - 1].x
  } ${CHART_HEIGHT - PADDING.bottom} L ${PADDING.left} ${
    CHART_HEIGHT - PADDING.bottom
  } Z`
  const trendLabel = getTrendLabel(points)
  const isPositiveTrend = points[points.length - 1].value >= points[0].value
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-card p-4",
        toneClassNames[tone],
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">
              {value}
            </span>
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-xs font-medium",
                isPositiveTrend
                  ? "border-success/20 bg-success/10 text-success-foreground"
                  : "border-destructive/20 bg-destructive/10 text-destructive-foreground"
              )}
            >
              {trendLabel}
            </span>
          </div>
        </div>
        <div className="shrink-0 rounded-md border bg-background/80 px-2 py-1 text-right">
          <div className="text-xs text-muted-foreground">
            {activePoint.label}
          </div>
          <div className="text-sm font-medium text-foreground">
            {formatPercent(activePoint.value)}
          </div>
        </div>
      </div>

      <svg
        aria-label={`${label} trend`}
        className="mt-4 block aspect-[360/176] h-auto w-full overflow-visible"
        onPointerLeave={() => {
          setHoveredIndex(null)
        }}
        onPointerMove={(event) => {
          setHoveredIndex(getActiveIndex(event, points.length))
        }}
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <defs>
          <linearGradient id={`${gradientId}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {getGridLines(bounds).map((line) => (
          <g key={line.label}>
            <line
              className="stroke-border"
              strokeDasharray="3 5"
              strokeWidth="1"
              x1={PADDING.left}
              x2={CHART_WIDTH - PADDING.right}
              y1={line.y}
              y2={line.y}
            />
            <text
              className="fill-muted-foreground text-[10px]"
              textAnchor="start"
              x={CHART_WIDTH - PADDING.right + 8}
              y={line.y + 3}
            >
              {line.label}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradientId}-area)`} />
        <path
          className="fill-none stroke-current"
          d={linePath}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <line
          className="stroke-foreground/20"
          strokeDasharray="4 4"
          strokeWidth="1"
          x1={activePoint.x}
          x2={activePoint.x}
          y1={PADDING.top}
          y2={CHART_HEIGHT - PADDING.bottom}
        />
        {positions.map((point) => (
          <circle
            className="fill-card stroke-current opacity-50"
            cx={point.x}
            cy={point.y}
            key={point.label}
            r="2.5"
            strokeWidth="1.5"
          />
        ))}
        <circle
          className="fill-card stroke-current"
          cx={activePoint.x}
          cy={activePoint.y}
          r="6"
          strokeWidth="2.5"
        />
        <circle
          className="fill-current"
          cx={activePoint.x}
          cy={activePoint.y}
          r="2.5"
        />

        <text
          className="fill-muted-foreground text-[10px]"
          textAnchor="start"
          x={PADDING.left}
          y={CHART_HEIGHT - 7}
        >
          {firstPoint.label}
        </text>
        <text
          className="fill-muted-foreground text-[10px]"
          textAnchor="end"
          x={CHART_WIDTH - PADDING.right}
          y={CHART_HEIGHT - 7}
        >
          {lastPoint.label}
        </text>
      </svg>
    </div>
  )
}
