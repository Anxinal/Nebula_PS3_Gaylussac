import type { ReactNode } from 'react'
import { InfoHint } from './InfoHint'

/**
 * When the story is a single number, it is a number — not a one-bar chart.
 * The label stays short; anything longer goes behind the info icon.
 */
export function StatTile({
  label,
  value,
  sub,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  hint?: ReactNode
  tone?: 'neutral' | 'good' | 'critical' | 'warning'
}) {
  const toneColor =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'critical'
        ? 'var(--status-critical)'
        : tone === 'warning'
          ? 'var(--status-warning)'
          : 'var(--text-primary)'
  return (
    <div className="card flex flex-col items-center px-4 py-4 text-center">
      <div className="flex items-center gap-1.5">
        <span className="eyebrow">{label}</span>
        {hint && <InfoHint label={`About ${label}`}>{hint}</InfoHint>}
      </div>
      <div className="display mt-1.5 text-3xl font-bold leading-none tracking-tight" style={{ color: toneColor }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-ink-secondary">{sub}</div>}
    </div>
  )
}

export function StatusPill({ status }: { status: 'Normal' | 'Abnormal resistance' }) {
  const abnormal = status === 'Abnormal resistance'
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        color: abnormal ? 'var(--status-critical)' : 'var(--status-good)',
        background: abnormal
          ? 'color-mix(in srgb, var(--status-critical) 14%, transparent)'
          : 'color-mix(in srgb, var(--status-good) 14%, transparent)',
      }}
    >
      <span aria-hidden>{abnormal ? '▲' : '✓'}</span>
      {status}
    </span>
  )
}

/**
 * A section heading whose explanation lives behind an icon rather than in a
 * paragraph under the title.
 */
export function SectionHead({
  title,
  hint,
  right,
}: {
  title: string
  hint?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-base font-bold tracking-tight text-ink">
        {title}
        {hint && <InfoHint label={`About ${title}`}>{hint}</InfoHint>}
      </h3>
      {right}
    </div>
  )
}
