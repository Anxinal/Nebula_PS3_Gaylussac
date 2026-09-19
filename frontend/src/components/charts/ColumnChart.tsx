import { useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'

export interface ColumnDatum {
  label: string
  value: number
  /** Overrides the series colour for this column. */
  color?: string
  detail?: string
}

/**
 * Vertical bars, one series: categories along the bottom, values up the side,
 * with both axes titled. Category labels tilt when there are too many to sit
 * level, so long file names still fit. Negative values hang below the zero line.
 */
export function ColumnChart({
  data,
  valueLabel,
  categoryLabel,
  color = 'var(--series-1)',
  highlightIndex = -1,
  maxColumns = 30,
}: {
  data: ColumnDatum[]
  /** Title of the vertical (value) axis. */
  valueLabel: string
  /** Title of the horizontal (category) axis. */
  categoryLabel: string
  color?: string
  highlightIndex?: number
  maxColumns?: number
}) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const cols = data.slice(0, maxColumns)
  if (cols.length === 0) return null

  // Labels sit level when few and short; otherwise they tilt and the bottom margin grows to fit them.
  const longest = Math.max(...cols.map((d) => Math.min(d.label.length, 16)))
  const tilt = cols.length > 8 || longest * cols.length > 70
  const LABEL_H = tilt ? 14 + longest * 4.6 : 20

  const width = 720
  const PAD_L = 64 // tick values plus the rotated value-axis title
  const PAD_R = 12
  const PAD_T = 12
  const PLOT_H = 220
  const PAD_B = LABEL_H + 26 // category labels, then the category-axis title
  const height = PAD_T + PLOT_H + PAD_B

  const values = cols.map((d) => d.value)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const y = linearScale([min, max || 1], [PAD_T + PLOT_H, PAD_T])
  const zero = y(0)
  const tickValues = ticks(min, max || 1, 5)

  const slot = (width - PAD_L - PAD_R) / cols.length
  const barW = Math.max(3, Math.min(48, slot * 0.72))

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${valueLabel} by ${categoryLabel}`}>
        {tickValues.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke={CHART_INK.grid} strokeWidth={1} />
            <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="tnum" fontSize={11} fill={CHART_INK.muted}>
              {fmt(t)}
            </text>
          </g>
        ))}

        {cols.map((d, i) => {
          const cx = PAD_L + slot * (i + 0.5)
          const top = Math.min(y(d.value), zero)
          const h = Math.max(2, Math.abs(y(d.value) - zero))
          const fill = d.color ?? (i === highlightIndex ? 'var(--series-2)' : color)
          const labelY = PAD_T + PLOT_H + 14
          const text = d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label
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
              {/* Hit target spans the whole column slot, not just the bar. */}
              <rect x={cx - slot / 2} y={PAD_T} width={slot} height={PLOT_H} fill="transparent" />
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={3} fill={fill} />
              <text
                x={cx}
                y={labelY}
                textAnchor={tilt ? 'end' : 'middle'}
                transform={tilt ? `rotate(-40 ${cx} ${labelY})` : undefined}
                fontSize={11}
                fill={i === highlightIndex ? CHART_INK.primary : CHART_INK.secondary}
                fontWeight={i === highlightIndex ? 600 : 400}
              >
                {text}
              </text>
            </g>
          )
        })}

        <line x1={PAD_L} x2={width - PAD_R} y1={zero} y2={zero} stroke={CHART_INK.axis} strokeWidth={1} />

        {/* Axis titles */}
        <text
          x={16}
          y={PAD_T + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${PAD_T + PLOT_H / 2})`}
          fontSize={12}
          fontWeight={600}
          fill={CHART_INK.secondary}
        >
          {valueLabel}
        </text>
        <text
          x={PAD_L + (width - PAD_L - PAD_R) / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize={12}
          fontWeight={600}
          fill={CHART_INK.secondary}
        >
          {categoryLabel}
        </text>
      </svg>
      <ChartTooltip tip={tip} />
      {data.length > maxColumns && (
        <p className="mt-2 text-xs text-ink-muted">
          Showing the first {maxColumns} of {data.length} — the table below has them all.
        </p>
      )}
    </div>
  )
}
