import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

/**
 * Chart tooltip. Positioned in the chart's own coordinate space by the caller
 * and rendered above the SVG, so it is never clipped by the plot area.
 *
 * It opens above the point by default, but flips to open below when there
 * isn't room — a bar tall enough to reach near the top of the chart would
 * otherwise push the box up past the chart entirely, over whatever sits above
 * it (a panel title, another tile). Measured after each render, the same way
 * InfoHint flips its own popovers.
 */
export function ChartTooltip({ tip }: { tip: TooltipState | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [below, setBelow] = useState(false)

  useLayoutEffect(() => {
    if (!tip) return
    const h = ref.current?.offsetHeight ?? 0
    setBelow(tip.y - h - 10 < 0)
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-hairline
                 bg-surface px-3 py-2 text-xs leading-relaxed text-ink shadow-lg"
      style={{
        left: tip.x,
        top: below ? tip.y + 10 : tip.y,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, calc(-100% - 10px))',
      }}
      role="status"
    >
      {tip.content}
    </div>
  )
}
