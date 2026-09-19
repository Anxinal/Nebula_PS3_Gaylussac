import { useState } from 'react'
import { ChartTooltip, type TooltipState } from './ChartTooltip'
import { fmt } from './chartUtils'

export interface PieDatum {
  label: string
  value: number
  color: string
  detail?: string
  /** The individual cases in this slice (e.g. file names), shown on hover. */
  items?: string[]
}

/**
 * A single pie, with each slice's share as a percentage inside it (when there's
 * room) and a legend below carrying the exact counts — colour is never the only
 * way to read a slice.
 */
export function PieChart({ data, compact = false }: { data: PieDatum[]; compact?: boolean }) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const slices = data.filter((d) => d.value > 0)

  const size = compact ? 240 : 380
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.34
  const labelR = r * 0.62

  if (total <= 0 || slices.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing to plot.</p>
  }

  const point = (angle: number, radius: number) => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)]

  let start = 0
  const arcs = slices.map((d) => {
    const share = d.value / total
    const angle0 = start
    const angle1 = start + share * Math.PI * 2
    start = angle1
    const mid = (angle0 + angle1) / 2
    const [x0, y0] = point(angle0, r)
    const [x1, y1] = point(angle1, r)
    const large = angle1 - angle0 > Math.PI ? 1 : 0
    const path = slices.length === 1 ? '' : `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
    const [lx, ly] = point(mid, labelR)
    return { d, share, path, lx, ly }
  })

  return (
    <div className="relative flex flex-col items-center gap-3">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className={compact ? 'w-full max-w-[13rem]' : 'w-full max-w-sm'}
        role="img"
        aria-label={`${data.map((d) => `${d.label}: ${d.value}`).join(', ')}`}
      >
        {slices.length === 1 ? (
          <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
        ) : (
          arcs.map(({ d, path }, i) => (
            <path
              key={d.label + i}
              d={path}
              fill={d.color}
              stroke="var(--surface-1)"
              strokeWidth={2}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: (
                    <>
                      <div className="font-medium">{d.label}</div>
                      <div className="tnum text-ink-secondary">
                        {d.value} ({fmt((d.value / total) * 100, 3)}%)
                      </div>
                      {d.detail && <div className="text-ink-secondary">{d.detail}</div>}
                      {d.items && d.items.length > 0 && (
                        <div className="mt-1 border-t border-hairline pt-1 text-ink-secondary">
                          {d.items.slice(0, 8).join(', ')}
                          {d.items.length > 8 && `, +${d.items.length - 8} more`}
                        </div>
                      )}
                    </>
                  ),
                })
              }}
              onMouseLeave={() => setTip(null)}
            />
          ))
        )}
        {/* Percentage inside each slice, only when the slice is wide enough to read */}
        {arcs
          .filter(({ share }) => share >= 0.08)
          .map(({ d, share, lx, ly }, i) => (
            <text
              key={`label-${d.label}-${i}`}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={compact ? 11 : 13}
              fontWeight={700}
              fill="#fff"
              style={{ paintOrder: 'stroke', stroke: 'color-mix(in srgb, #000 35%, transparent)', strokeWidth: 3 }}
              pointerEvents="none"
            >
              {fmt(share * 100, 2)}%
            </text>
          ))}
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
        {data.map((d) => (
          <li key={d.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="font-medium text-ink">{d.label}</span>
            <span className="tnum">{d.value}</span>
          </li>
        ))}
      </ul>
      <ChartTooltip tip={tip} />
    </div>
  )
}
