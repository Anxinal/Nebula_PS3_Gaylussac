import { useState } from 'react'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../../subsystems'
import { buildPredictionsZip } from '../../lib/zip'
import { downloadBlob } from '../../lib/predictionCsv'
import { DownloadIcon, SUBSYSTEM_ICON } from '../icons'
import { fmt } from '../charts/chartUtils'
import { damageColor } from './ShmResults'
import type { RunRecord, SubsystemId } from '../../types'

/**
 * Fleet overview: every subsystem on one page, each with the headline figures of
 * its latest run. Everything shown is counted or picked straight from the run's
 * result; nothing is estimated here.
 */
export function Overview({
  runs,
  onOpen,
  onAnalyse,
}: {
  runs: Map<SubsystemId, RunRecord>
  /** Switch to a subsystem's own tab. */
  onOpen: (id: SubsystemId) => void
  /** Go back to the console with this subsystem picked, to run it. */
  onAnalyse: (id: SubsystemId) => void
}) {
  const [busy, setBusy] = useState(false)
  const done = SUBSYSTEM_ORDER.filter((id) => runs.has(id))

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-secondary">
          {done.length} of 4 subsystems analysed in this session.
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={done.length === 0 || busy}
          onClick={async () => {
            setBusy(true)
            try {
              downloadBlob('predictions.zip', await buildPredictionsZip(done.map((id) => runs.get(id)!)))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? (
            'Packaging…'
          ) : (
            <>
              <DownloadIcon /> predictions.zip
            </>
          )}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {SUBSYSTEM_ORDER.map((id) => {
          const run = runs.get(id)
          const meta = SUBSYSTEMS[id]
          const Icon = SUBSYSTEM_ICON[id]
          return (
            <article key={id} className="card flex flex-col p-4">
              <header className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[1.15rem]"
                  style={{ color: 'var(--series-1)', background: 'color-mix(in srgb, var(--series-1) 12%, transparent)' }}
                >
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="display truncate text-base font-bold text-ink">{meta.name}</h3>
                  <p className="text-xs text-ink-muted">
                    {run
                      ? `${run.engine === 'backend' ? 'Trained model' : 'Baseline'} · ${run.inputFiles.length} file${run.inputFiles.length === 1 ? '' : 's'}`
                      : 'Not analysed yet'}
                  </p>
                </div>
              </header>

              <div className="mt-3 flex-1">{run ? <Headline run={run} /> : null}</div>

              <div className="mt-3">
                {run ? (
                  <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => onOpen(id)}>
                    See full result →
                  </button>
                ) : (
                  <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => onAnalyse(id)}>
                    Analyse {meta.name} →
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/** The two or three figures that sum up one run, all counted from its result. */
function Headline({ run }: { run: RunRecord }) {
  const r = run.result
  switch (r.kind) {
    case 'door': {
      const abnormal = r.segments.filter((s) => s.prediction === 'Abnormal resistance').length
      return (
        <Figures
          items={[
            { label: 'Door cycles', value: String(r.segments.length) },
            { label: 'Abnormal resistance', value: String(abnormal), tone: abnormal > 0 ? 'var(--status-critical)' : 'var(--status-good)' },
          ]}
        />
      )
    }
    case 'acv':
      return (
        <ul className="space-y-1 text-sm">
          {r.files.slice(0, 4).map((f) => (
            <li key={f.fileId} className="flex justify-between gap-3">
              <span className="truncate text-ink-secondary">{f.fileId}</span>
              <span className="shrink-0 font-semibold text-ink">
                {f.cars[0] ? `Car ${f.cars[0].car} most likely` : '—'}
              </span>
            </li>
          ))}
          {r.files.length > 4 && <li className="text-xs text-ink-muted">…and {r.files.length - 4} more</li>}
        </ul>
      )
    case 'rail': {
      const count = (label: string) => r.files.filter((f) => f.prediction === label).length
      return (
        <Figures
          items={[
            { label: 'Normal', value: String(count('Normal')), tone: 'var(--status-good)' },
            { label: 'Side I', value: String(count('Side I')), tone: count('Side I') > 0 ? 'var(--status-critical)' : undefined },
            { label: 'Side II', value: String(count('Side II')), tone: count('Side II') > 0 ? 'var(--status-critical)' : undefined },
          ]}
        />
      )
    }
    case 'shm': {
      const highest = Math.max(...r.files.map((f) => f.prediction))
      const failed = r.files.filter((f) => f.prediction >= 1).length
      return (
        <Figures
          items={[
            { label: 'Segments', value: String(r.files.length) },
            { label: 'Highest damage D', value: fmt(highest, 3), tone: damageColor(highest) },
            { label: 'At or past D = 1', value: String(failed), tone: failed > 0 ? 'var(--status-critical)' : 'var(--status-good)' },
          ]}
        />
      )
    }
  }
}

function Figures({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-hairline px-3 py-2">
          <dt className="text-[0.68rem] leading-tight text-ink-muted">{it.label}</dt>
          <dd className="display tnum mt-0.5 text-xl font-bold" style={{ color: it.tone ?? 'var(--text-primary)' }}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
