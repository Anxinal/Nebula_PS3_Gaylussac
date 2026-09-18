import { useRef, useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { CHART_INK, fmt, linearScale, ticks } from './chartUtils'
import type { DoorSegment } from '../../types'

const STATUS_COLOR = {
  Normal: 'var(--status-good)',
  'Abnormal resistance': 'var(--status-critical)',
} as const

/**
 * Where every detected door cycle sits in the stream, and how each was called.
 * Status colour carries the call, but the legend below pairs each colour with an
 * icon and its label, and every segment is also listed in the table — colour is
 * never the only channel.
 */
export function SegmentTimeline({
  segments,
  durationSec,
  onSelect,
  selectedIndex,
}: {
  segments: DoorSegment[]
  durationSec: number
  onSelect?: (index: number) => void
  selectedIndex?: number
}) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const width = 900
  const height = 92
  const PAD_L = 10
  const PAD_R = 10
  const TRACK_Y = 22
  const TRACK_H = 34

  const x = linearScale([0, durationSec || 1], [PAD_L, width - PAD_R])
  const xt = ticks(0, durationSec || 1, 7)

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Detected door cycles over the stream">
        <rect x={PAD_L} y={TRACK_Y} width={width - PAD_L - PAD_R} height={TRACK_H} rx={6} fill="var(--gridline)" opacity={0.45} />

        {segments.map((s, i) => {
          const from = s.startOffsetSec ?? 0
          const to = s.endOffsetSec ?? from
          // Very short cycles on a long stream would vanish; keep them clickable.
          const w = Math.max(3, x(to) - x(from))
          const selected = selectedIndex === i
          return (
            <rect
              key={i}
              x={x(from)}
              y={TRACK_Y + (selected ? 0 : 3)}
              width={w}
              height={TRACK_H - (selected ? 0 : 6)}
              rx={3}
              fill={STATUS_COLOR[s.prediction]}
              stroke={selected ? CHART_INK.primary : 'none'}
              strokeWidth={selected ? 2 : 0}
              className="cursor-pointer"
              onClick={() => onSelect?.(i)}
              onMouseMove={(e) => {
                const rect = svgRef.current!.getBoundingClientRect()
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: (
                    <>
                      <div className="font-medium">
                        {s.prediction === 'Normal' ? '✓ Normal' : '▲ Abnormal resistance'}
                      </div>
                      <div className="text-ink-secondary">
                        {s.operation ?? 'Cycle'} · {fmt(to - from, 3)} s
                      </div>
                      <div className="tnum text-ink-secondary">{s.startTime}</div>
                      {s.meanCurrent !== undefined && (
                        <div className="tnum text-ink-secondary">mean {fmt(s.meanCurrent, 4)} mA</div>
                      )}
                    </>
                  ),
                })
              }}
              onMouseLeave={() => setTip(null)}
            />
          )
        })}

        <line x1={PAD_L} x2={width - PAD_R} y1={TRACK_Y + TRACK_H + 8} y2={TRACK_Y + TRACK_H + 8} stroke={CHART_INK.grid} strokeWidth={1} />
        {xt.map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="tnum" fontSize={11} fill={CHART_INK.muted}>
            {fmt(t)}s
          </text>
        ))}
      </svg>
      <ChartTooltip tip={tip} />
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: STATUS_COLOR.Normal }} aria-hidden />
          <span aria-hidden>✓</span> Normal
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: STATUS_COLOR['Abnormal resistance'] }} aria-hidden />
          <span aria-hidden>▲</span> Abnormal resistance
        </span>
        <span className="text-ink-muted">Click a cycle to inspect it</span>
      </div>
    </div>
  )
}
