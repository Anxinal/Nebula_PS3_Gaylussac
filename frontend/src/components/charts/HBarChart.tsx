import { useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'

export interface HBarDatum {
  label: string
  value: number
  /** Overrides the series colour — used to mark the one row that matters. */
  color?: string
  detail?: string
}

/**
 * Horizontal bars, one series. Horizontal because the categories are named
 * things (files, cars) whose labels need room to be read.
 */
export function HBarChart({
  data,
  valueLabel,
  color = 'var(--series-1)',
  highlightIndex = -1,
  maxRows = 24,
}: {
  data: HBarDatum[]
  valueLabel: string
  color?: string
  highlightIndex?: number
  maxRows?: number
}) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const rows = data.slice(0, maxRows)
  if (rows.length === 0) return null

  const ROW_H = 26
  const GAP = 2 // 2px surface gap between adjacent fills
  const PAD_L = 92
  const PAD_R = 16
  const PAD_T = 8
  const AXIS_H = 26
  const width = 640
  const height = PAD_T + rows.length * ROW_H + AXIS_H

  const values = rows.map((d) => d.value)
  const min = Math.min(0, ...values)
  const max = Math.max(...values, 0)
  const x = linearScale([min, max || 1], [PAD_L, width - PAD_R])
  const zero = x(0)
  const tickValues = ticks(min, max || 1, 5)

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${valueLabel} by ${rows.length} rows`}
      >
        {tickValues.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={PAD_T}
              y2={height - AXIS_H}
              stroke={CHART_INK.grid}
              strokeWidth={1}
            />
            <text
              x={x(t)}
              y={height - 8}
              textAnchor="middle"
              className="tnum"
              fontSize={11}
              fill={CHART_INK.muted}
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {rows.map((d, i) => {
          const y = PAD_T + i * ROW_H + GAP / 2
          const h = ROW_H - GAP
          const barX = d.value >= 0 ? zero : x(d.value)
          const barW = Math.max(2, Math.abs(x(d.value) - zero))
          const fill = d.color ?? (i === highlightIndex ? 'var(--series-2)' : color)
          return (
            <g
              key={d.label + i}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: (
                    <>
                      <div className="font-medium">{d.label}</div>
                      <div className="tnum text-ink-secondary">
                        {valueLabel}: {fmt(d.value, 4)}
                      </div>
                      {d.detail && <div className="text-ink-secondary">{d.detail}</div>}
                    </>
                  ),
                })
              }}
              onMouseLeave={() => setTip(null)}
            >
              {/* Hit target spans the full row, not just the bar. */}
              <rect x={0} y={PAD_T + i * ROW_H} width={width} height={ROW_H} fill="transparent" />
              <text
                x={PAD_L - 10}
                y={y + h / 2 + 4}
                textAnchor="end"
                fontSize={11}
                fill={i === highlightIndex ? CHART_INK.primary : CHART_INK.secondary}
                fontWeight={i === highlightIndex ? 600 : 400}
              >
                {d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label}
              </text>
              <rect x={barX} y={y} width={barW} height={h} rx={4} fill={fill} />
            </g>
          )
        })}

        <line
          x1={zero}
          x2={zero}
          y1={PAD_T}
          y2={height - AXIS_H}
          stroke={CHART_INK.axis}
          strokeWidth={1}
        />
      </svg>
      <ChartTooltip tip={tip} />
      {data.length > maxRows && (
        <p className="mt-2 text-xs text-ink-muted">
          Showing the first {maxRows} of {data.length} — the table below has them all.
        </p>
      )}
    </div>
  )
}
