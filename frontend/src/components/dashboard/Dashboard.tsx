import { useEffect, useState } from 'react'
import { WhyPanel } from '../results/WhyPanel'
import { buildDashboard, buildVerdict } from './panels'
import type { RunRecord } from '../../types'

/**
 * One subsystem's result as a dashboard: a plain normal/not-normal verdict right
 * at the top, then headline figures and a grid of small charts. Clicking a chart
 * opens it full size on its own page, with what it shows and what the data says,
 * and the rows behind it. The model's own reasoning — "why" it decided this —
 * sits at the bottom, for whoever wants to dig past the verdict.
 *
 * Which panel (if any) is open full-size is owned by the caller, not this
 * component — the header's "Back to dashboard" button needs to see and clear
 * it too, so it lives in App.tsx alongside "Back to analyse" and "Past analysis".
 */
export function Dashboard({
  run,
  openPanelId,
  onOpenPanel,
}: {
  run: RunRecord
  openPanelId: string | null
  onOpenPanel: (id: string | null) => void
}) {
  const [fileIndex, setFileIndex] = useState(0)
  const spec = buildDashboard(run.result, fileIndex)
  const verdict = buildVerdict(run.result)
  const open = spec.panels.find((p) => p.id === openPanelId)

  // A new run (or subsystem) starts back on the grid, on its first file.
  useEffect(() => {
    setFileIndex(0)
  }, [run])

  const openPanel = (id: string) => {
    onOpenPanel(id)
    window.scrollTo({ top: 0 })
  }

  const fileSelect = spec.files && spec.files.length > 1 && (
    <label className="flex items-center gap-2 text-sm text-ink-secondary">
      {spec.fileNoun ?? 'File'}
      <select
        className="rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink"
        value={Math.min(fileIndex, spec.files.length - 1)}
        onChange={(e) => setFileIndex(Number(e.target.value))}
      >
        {spec.files.map((name, i) => (
          <option key={name} value={i}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )

  if (open) {
    return (
      <section className="fade-in space-y-4">
        {/* "Back to dashboard" now lives in the header, beside "Past analysis". */}
        {fileSelect && <div className="flex justify-end">{fileSelect}</div>}
        <h2 className="display text-2xl font-bold tracking-tight text-ink">{open.title}</h2>
        <div className="card p-4 sm:p-6">{open.large}</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4">
            <h3 className="eyebrow">What this shows</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{open.about}</p>
          </div>
          <div className="card p-4">
            <h3 className="eyebrow">What the data says</h3>
            {open.facts.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-secondary">
                {open.facts.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="text-ink-muted">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Nothing further to report from this result.</p>
            )}
          </div>
        </div>
        {open.table && <div className="card overflow-hidden">{open.table}</div>}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* The plain verdict, first thing on the page: normal, or not, and by how much */}
      <div
        className="card flex items-center gap-3 border-2 px-5 py-4"
        style={{ borderColor: verdict.status === 'critical' ? 'var(--status-critical)' : 'var(--status-good)' }}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold"
          style={{
            color: verdict.status === 'critical' ? 'var(--status-critical)' : 'var(--status-good)',
            background:
              verdict.status === 'critical'
                ? 'color-mix(in srgb, var(--status-critical) 14%, transparent)'
                : 'color-mix(in srgb, var(--status-good) 14%, transparent)',
          }}
        >
          {verdict.status === 'critical' ? '!' : '✓'}
        </span>
        <div className="min-w-0">
          <p
            className="display text-lg font-bold leading-tight"
            style={{ color: verdict.status === 'critical' ? 'var(--status-critical)' : 'var(--status-good)' }}
          >
            {verdict.label}
          </p>
          {verdict.detail && <p className="text-sm text-ink-secondary">{verdict.detail}</p>}
        </div>
      </div>

      {fileSelect && <div className="flex justify-end">{fileSelect}</div>}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {spec.kpis.map((k) => (
          <div key={k.label} className="card px-4 py-3">
            <dt className="eyebrow">{k.label}</dt>
            <dd className="display tnum mt-1 truncate text-2xl font-bold leading-tight" style={{ color: k.tone ?? 'var(--text-primary)' }}>
              {k.value}
            </dd>
            {k.sub && <dd className="mt-0.5 truncate text-xs text-ink-secondary">{k.sub}</dd>}
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        {spec.panels.map((p) => (
          // A clickable tile rather than a <button>: it holds whole charts, which a button may not contain.
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => openPanel(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openPanel(p.id)
              }
            }}
            className={`card pick-card group flex cursor-pointer flex-col p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${p.wide ? 'md:col-span-2' : ''}`}
            aria-label={`Open ${p.title}`}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink">{p.title}</span>
              <span aria-hidden className="shrink-0 text-xs text-ink-muted transition-transform group-hover:translate-x-0.5">
                Open →
              </span>
            </span>
            <div className="mt-2 w-full">{p.small}</div>
          </div>
        ))}
      </div>

      {/* The model's own reasoning goes last, for whoever wants to dig past the verdict above */}
      <WhyPanel result={run.result} />
    </section>
  )
}
