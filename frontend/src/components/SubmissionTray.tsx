import { useState } from 'react'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../subsystems'
import { buildPredictionsZip } from '../lib/zip'
import { downloadBlob, downloadText } from '../lib/predictionCsv'
import { DownloadIcon } from './icons'
import { InfoHint } from './InfoHint'
import type { RunRecord, SubsystemId } from '../types'

/**
 * Deliverable 2 of PS3: one predictions.zip holding the *_predictions.csv files
 * for every subsystem attempted, at the top level with no subfolders.
 */
export function SubmissionTray({
  runs,
  onOpen,
}: {
  runs: Map<SubsystemId, RunRecord>
  onOpen: (id: SubsystemId) => void
}) {
  const [busy, setBusy] = useState(false)
  const done = SUBSYSTEM_ORDER.filter((id) => runs.has(id))

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-bold tracking-tight text-ink">
            Submission bundle
            <InfoHint label="About the submission bundle">
              PS3 asks for one predictions.zip holding a *_predictions.csv for each subsystem you attempted, at the
              top level of the archive with no subfolders. Every run you complete drops its file in here; the button
              packages them in exactly that shape.
            </InfoHint>
          </h2>
          <p className="mt-0.5 text-xs text-ink-secondary">
            {done.length === 0 ? 'Run a subsystem to fill it.' : `${done.length} of 4 ready.`}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={done.length === 0 || busy}
          onClick={async () => {
            setBusy(true)
            try {
              const blob = await buildPredictionsZip(done.map((id) => runs.get(id)!))
              downloadBlob('predictions.zip', blob)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Packaging…' : <><DownloadIcon /> predictions.zip</>}
        </button>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {SUBSYSTEM_ORDER.map((id) => {
          const run = runs.get(id)
          const meta = SUBSYSTEMS[id]
          return (
            <li
              key={id}
              className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span aria-hidden style={{ color: run ? 'var(--status-good)' : 'var(--text-muted)' }}>
                    {run ? '✓' : '○'}
                  </span>
                  <span className="font-semibold text-ink">{meta.name}</span>
                </div>
                <div className="mt-0.5 truncate text-ink-muted">
                  {run ? `${meta.outputFile} · ${rowCount(run)} rows` : 'not run yet'}
                </div>
              </div>
              {run ? (
                <div className="ml-3 flex shrink-0 gap-1">
                  <button type="button" className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => onOpen(id)}>
                    View
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-[11px]"
                    onClick={() => downloadText(run.csv.filename, run.csv.content)}
                  >
                    CSV
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => onOpen(id)}>
                  Start
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function rowCount(run: RunRecord): number {
  // The header line does not count as a prediction row.
  return run.csv.content.trim().split('\n').length - 1
}
