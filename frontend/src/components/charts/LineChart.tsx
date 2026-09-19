import { useMemo, useRef, useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'

export interface Band {
  from: number
  to: number
  color: string
  label: string
}

export interface LineLegendEntry {
  label: string
  color: string
}

/**
 * Single-series line with a crosshair. Optional shaded bands mark the detected
 * segments underneath the trace, so timing and signal are read together. A
 * centred legend below names the line and, when the bands use more than one
 * colour, what each of those means too.
 */
export function LineChart({
  points,
  xLabel,
  yLabel,
  bands = [],
  bandLegend,
  height = 200,
  color = 'var(--series-1)',
  compact = false,
}: {
  points: { t: number; value: number }[]
  xLabel: string
  yLabel: string
  bands?: Band[]
  /** What each distinct band colour means, for the legend. */
  bandLegend?: LineLegendEntry[]
  height?: number
  color?: string
  /** Dashboard-tile size: a narrower canvas, so the same type size reads larger. */
  compact?: boolean
}) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const PAD_L = 68 // tick values plus the rotated y-axis title
  const PAD_R = 14
  const PAD_T = 10
  const PAD_B = 46 // tick values plus the x-axis title
  const width = compact ? 460 : 900

  const { x, y, path, xt, yt } = useMemo(() => {
    const xs = points.map((p) => p.t)
    const ys = points.map((p) => p.value)
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    const yMin = Math.min(0, ...ys)
    const yMax = Math.max(...ys)
    const sx = linearScale([xMin, xMax], [PAD_L, width - PAD_R])
    const sy = linearScale([yMin, yMax || 1], [height - PAD_B, PAD_T])
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p.value).toFixed(1)}`).join('')
    return { x: sx, y: sy, path: d, xt: ticks(xMin, xMax, 6), yt: ticks(yMin, yMax || 1, 4) }
  }, [points, height])

  if (points.length === 0) return null

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const tValue = x.domain[0] + ((px - PAD_L) / (width - PAD_R - PAD_L)) * (x.domain[1] - x.domain[0])
    // Nearest point by x — the series is dense and evenly spaced.
    let nearest = points[0]
    let best = Infinity
    for (const p of points) {
      const d = Math.abs(p.t - tValue)
      if (d < best) {
        best = d
        nearest = p
      }
    }
    setCursor(nearest.t)
    const band = bands.find((b) => nearest.t >= b.from && nearest.t <= b.to)
    setTip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      content: (
        <>
          <div className="tnum font-medium">
            {fmt(nearest.value, 4)} <span className="font-normal text-ink-secondary">{yLabel}</span>
          </div>
          <div className="tnum text-ink-secondary">
            {xLabel} {fmt(nearest.t, 4)}
          </div>
          {band && <div className="mt-1 text-ink-secondary">{band.label}</div>}
        </>
      ),
    })
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${yLabel} over ${xLabel}`}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null)
          setCursor(null)
        }}
      >
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke={CHART_INK.grid} strokeWidth={1} />
            <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="tnum" fontSize={11} fill={CHART_INK.muted}>
              {fmt(t)}
            </text>
          </g>
        ))}

        {bands.map((b, i) => (
          <rect
            key={i}
            x={x(b.from)}
            y={PAD_T}
            width={Math.max(1.5, x(b.to) - x(b.from))}
            height={height - PAD_B - PAD_T}
            fill={b.color}
            opacity={0.16}
          />
        ))}

        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {cursor !== null && (
          <line x1={x(cursor)} x2={x(cursor)} y1={PAD_T} y2={height - PAD_B} stroke={CHART_INK.axis} strokeWidth={1} />
        )}

        <line x1={PAD_L} x2={width - PAD_R} y1={height - PAD_B} y2={height - PAD_B} stroke={CHART_INK.axis} strokeWidth={1} />
        {xt.map((t) => (
          <text key={`x${t}`} x={x(t)} y={height - PAD_B + 16} textAnchor="middle" className="tnum" fontSize={11} fill={CHART_INK.muted}>
            {fmt(t)}
          </text>
        ))}

        {/* Axis titles */}
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
      <ChartTooltip tip={tip} />
      <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-ink-secondary">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: color }} />
          {yLabel}
        </li>
        {bandLegend?.map((e) => (
          <li key={e.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e.color, opacity: 0.6 }} />
            {e.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
