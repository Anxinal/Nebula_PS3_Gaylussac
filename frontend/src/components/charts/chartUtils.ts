/** Shared scale + tick helpers for the hand-built SVG charts. */

export interface Scale {
  (value: number): number
  domain: [number, number]
  range: [number, number]
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  const fn = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale
  fn.domain = domain
  fn.range = range
  return fn
}

/** "Nice" round tick values covering the domain — at most `count` of them. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]
  const span = max - min
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toFixed(10)))
  }
  return out
}

/** Compact number formatting for axes and labels. */
export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2)
  if (abs >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return Number(v.toPrecision(digits)).toString()
}

export const CHART_INK = {
  grid: 'var(--gridline)',
  axis: 'var(--axis)',
  muted: 'var(--text-muted)',
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  surface: 'var(--surface-1)',
}
