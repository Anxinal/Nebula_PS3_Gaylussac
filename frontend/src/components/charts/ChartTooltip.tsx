import type { ReactNode } from 'react'

export interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

/**
 * Chart tooltip. Positioned in the chart's own coordinate space by the caller
 * and rendered above the SVG, so it is never clipped by the plot area.
 */
export function ChartTooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-hairline
                 bg-surface px-3 py-2 text-xs leading-relaxed text-ink shadow-lg"
      style={{
        left: tip.x,
        top: tip.y,
        transform: 'translate(-50%, calc(-100% - 10px))',
      }}
      role="status"
    >
      {tip.content}
    </div>
  )
}
