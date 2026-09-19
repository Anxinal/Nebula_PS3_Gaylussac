import { useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'

export interface GroupedDatum {
  label: string
  /** One value per series, in the same order as `seriesLabels`. */
  values: number[]
  detail?: string
}

/**
 * A comparative bar chart: each category gets one bar per series, side by side,
 * all rising from a single zero baseline — so two quantities that share a scale
 * (here, Side I and Side II's probabilities) are read by height, directly
 * against each other, rather than folded into one signed difference.
 */
export function GroupedColumnChart({
  data,
  seriesLabels,
  seriesColors,
  valueLabel,
  categoryLabel,
  compact = false,
  maxColumns = compact ? 10 : 30,
}: {
  data: GroupedDatum[]
  seriesLabels: string[]
  seriesColors: string[]
  /** Title of the vertical (value) axis. */
  valueLabel: string
  /** Title of the horizontal (category) axis. */
  categoryLabel: string
  compact?: boolean
  maxColumns?: number
}) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const cols = data.slice(0, maxColumns)
  if (cols.length === 0) return null

  const maxChars = compact ? 10 : 16
  const longest = Math.max(...cols.map((d) => Math.min(d.label.length, maxChars)))
  const tilt = cols.length > (compact ? 5 : 8) || longest * cols.length > (compact ? 36 : 70)
  const LABEL_H = tilt ? 14 + longest * 4.6 : 20

  const values = cols.flatMap((d) => d.values)
  const max = Math.max(0, ...values)
  const tickValues = ticks(0, max || 1, 5)

  const width = compact ? 400 : 720
  const widestTick = Math.max(...tickValues.map((t) => fmt(t).length), 1)
  const PAD_L = Math.max(48, 34 + widestTick * 6.5)
  const PAD_R = 12
  const PAD_T = 12
  const PLOT_H = compact ? 130 : 240
  const PAD_B = LABEL_H + 26
  const height = PAD_T + PLOT_H + PAD_B

  const y = linearScale([0, max || 1], [PAD_T + PLOT_H, PAD_T])
  const zero = y(0)

  const n = seriesLabels.length
  const slot = (width - PAD_L - PAD_R) / cols.length
  const groupW = slot * 0.78
  const barGap = compact ? 2 : 3
  const barW = Math.max(2, (groupW - barGap * (n - 1)) / n)

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
          const groupLeft = cx - groupW / 2
          const labelY = PAD_T + PLOT_H + 14
          const text = d.label.length > maxChars ? `${d.label.slice(0, maxChars - 1)}…` : d.label
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
                      {seriesLabels.map((name, si) => (
                        <div key={name} className="tnum text-ink-secondary">
                          {name}: {fmt(d.values[si] ?? 0, 4)}
                        </div>
                      ))}
                      {d.detail && <div className="text-ink-secondary">{d.detail}</div>}
                    </>
                  ),
                })
              }}
              onMouseLeave={() => setTip(null)}
            >
              {/* Hit target spans the whole group slot, not just the bars. */}
              <rect x={cx - slot / 2} y={PAD_T} width={slot} height={PLOT_H} fill="transparent" />
              {d.values.map((v, si) => {
                const barX = groupLeft + si * (barW + barGap)
                const h = Math.max(1.5, zero - y(v))
                return <rect key={si} x={barX} y={zero - h} width={barW} height={h} rx={2} fill={seriesColors[si]} />
              })}
              <text
                x={cx}
                y={labelY}
                textAnchor={tilt ? 'end' : 'middle'}
                transform={tilt ? `rotate(-40 ${cx} ${labelY})` : undefined}
                fontSize={11}
                fill={CHART_INK.secondary}
              >
                {text}
              </text>
            </g>
          )
        })}

        <line x1={PAD_L} x2={width - PAD_R} y1={zero} y2={zero} stroke={CHART_INK.axis} strokeWidth={1} />

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
      <ul className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-ink-secondary">
        {seriesLabels.map((name, i) => (
          <li key={name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColors[i] }} />
            {name}
          </li>
        ))}
      </ul>
      {data.length > maxColumns && (
        <p className="mt-2 text-xs text-ink-muted">
          Showing the first {maxColumns} of {data.length}
          {compact ? ' — open the chart for all of them.' : ' — the table below has them all.'}
        </p>
      )}
    </div>
  )
}
