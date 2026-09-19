import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'

export interface LineSeries {
  name: string
  points: { t: number; value: number }[]
  color: string
  /** Drawn thicker and on top, e.g. the car ranked most likely to be faulty. */
  emphasis?: boolean
}

/**
 * Several lines on shared axes, with a small legend. Emphasised series are drawn
 * last, so they sit on top of the rest.
 */
export function MultiLineChart({
  series,
  xLabel,
  yLabel,
  compact = false,
}: {
  series: LineSeries[]
  xLabel: string
  yLabel: string
  compact?: boolean
}) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) return null

  const width = compact ? 460 : 900
  const height = compact ? 200 : 300
  const PAD_L = 68
  const PAD_R = 14
  const PAD_T = 10
  const PAD_B = 46

  const xs = all.map((p) => p.t)
  const ys = all.map((p) => p.value)
  const x = linearScale([Math.min(...xs), Math.max(...xs)], [PAD_L, width - PAD_R])
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const pad = (yMax - yMin) * 0.05 || 1
  const y = linearScale([yMin - pad, yMax + pad], [height - PAD_B, PAD_T])
  const xt = ticks(x.domain[0], x.domain[1], compact ? 4 : 6)
  const yt = ticks(y.domain[0], y.domain[1], 4)
  const ordered = [...series].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis))

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${yLabel} over ${xLabel}`}>
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke={CHART_INK.grid} strokeWidth={1} />
            <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="tnum" fontSize={11} fill={CHART_INK.muted}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {ordered.map((s) => (
          <path
            key={s.name}
            d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.emphasis ? 2.4 : 1.2}
            strokeOpacity={s.emphasis ? 1 : 0.55}
            strokeLinejoin="round"
          />
        ))}
        <line x1={PAD_L} x2={width - PAD_R} y1={height - PAD_B} y2={height - PAD_B} stroke={CHART_INK.axis} strokeWidth={1} />
        {xt.map((t) => (
          <text key={`x${t}`} x={x(t)} y={height - PAD_B + 16} textAnchor="middle" className="tnum" fontSize={11} fill={CHART_INK.muted}>
            {fmt(t)}
          </text>
        ))}
        <text
          x={16}
          y={PAD_T + (height - PAD_B - PAD_T) / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${PAD_T + (height - PAD_B - PAD_T) / 2})`}
          fontSize={12}
          fontWeight={600}
          fill={CHART_INK.secondary}
        >
          {yLabel}
        </text>
        <text x={PAD_L + (width - PAD_L - PAD_R) / 2} y={height - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={CHART_INK.secondary}>
          {xLabel}
        </text>
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-ink-secondary">
        {series.map((s) => (
          <li key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: s.color, height: s.emphasis ? 3 : 2 }} />
            <span className={s.emphasis ? 'font-semibold text-ink' : ''}>{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
