import { useCallback, useEffect, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { Home } from './components/Home'
import { InfoHint } from './components/InfoHint'
import { DownloadIcon, AlertIcon } from './components/icons'
import { Header } from './components/Header'
import { SubsystemPicker } from './components/SubsystemPicker'
import { Dropzone } from './components/Dropzone'
import { Dashboard } from './components/dashboard/Dashboard'
import { SUBSYSTEMS } from './subsystems'
import { checkHealth, getApiBase, type BackendHealth } from './lib/api'
import { runSubsystem, type RunProgress } from './lib/runner'
import { downloadText } from './lib/predictionCsv'
import { loadRuns, saveRuns } from './lib/runsStorage'
import type { RunRecord, SubsystemId } from './types'

const MIN_LOADING_MS = 1000

/** "1m 30s", "45s" — for the loading screen's time-remaining estimate. */
function formatSeconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

type View = 'home' | 'console' | 'results'
const viewFromHash = (hash: string): View =>
  hash.startsWith('#/results') ? 'results' : hash.startsWith('#/app') ? 'console' : 'home'

export default function App() {
  // Three views, addressable by hash so the back button and a shared link both work:
  // the landing page, the upload console, and the results of the last analysis.
  const [view, setView] = useState<View>(() => (typeof location !== 'undefined' ? viewFromHash(location.hash) : 'home'))
  const [subsystem, setSubsystem] = useState<SubsystemId | null>(null)
  const [files, setFiles] = useState<File[]>([])
  // Every completed analysis survives a reload: loaded once from storage, saved back on every change.
  // Running the same subsystem again adds a new entry rather than replacing the last one.
  const [runs, setRuns] = useState<RunRecord[]>(loadRuns)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which specific run the results page shows.
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  // Which chart (if any) is open full-size within that run's dashboard; the header's
  // "Back to dashboard" button needs to see and clear this too.
  const [openPanelId, setOpenPanelId] = useState<string | null>(null)

  // A backend address saved earlier is still honoured; there is no longer a control to change it.
  const [apiBase] = useState(getApiBase)
  const [health, setHealth] = useState<BackendHealth>({ reachable: false, models: {}, detail: 'Checking for the trained models…' })
  // While an analysis runs, the page clears to the moving train and a load bar.
  const [loading, setLoading] = useState(false)
  // Ticks while loading, so the time-based estimate below can update against it.
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!loading) return
    const started = performance.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(performance.now() - started), 100)
    return () => clearInterval(id)
  }, [loading])

  const recheck = useCallback(async () => {
    setHealth(await checkHealth(getApiBase()))
  }, [])

  useEffect(() => {
    void recheck()
  }, [recheck])

  useEffect(() => {
    saveRuns(runs)
  }, [runs])

  useEffect(() => {
    const onHash = () => setView(viewFromHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const goHome = () => {
    location.hash = '#/'
    window.scrollTo({ top: 0 })
  }

  const openConsole = (id?: SubsystemId) => {
    if (id) {
      setSubsystem(id)
      setFiles([])
      setError(null)
    }
    location.hash = '#/app'
    window.scrollTo({ top: 0 })
  }

  const meta = subsystem ? SUBSYSTEMS[subsystem] : null
  const backendReady = health.reachable && subsystem !== null && health.models[subsystem] !== false

  // A real estimate, not a guess: the average time per file this subsystem's past runs actually took
  // with the trained model, scaled to how many files are queued now. With no history yet for this
  // subsystem, there is nothing honest to estimate from, so the bar falls back to indeterminate.
  const history = subsystem
    ? runs.filter((r) => r.subsystem === subsystem && r.engine === 'backend' && r.inputFiles.length > 0 && Number.isFinite(r.durationMs))
    : []
  const estimateMs =
    history.length > 0 && files.length > 0
      ? (history.reduce((sum, r) => sum + r.durationMs / r.inputFiles.length, 0) / history.length) * files.length
      : null
  const etaPct = estimateMs !== null ? Math.min(97, (elapsedMs / estimateMs) * 100) : null

  const onRun = async () => {
    if (!subsystem) return
    setError(null)
    setLoading(true)
    setProgress({ done: 0, total: files.length || 1, label: 'Starting…' })
    const started = performance.now()
    // The loading view stays up for at least a second, so it reads as a moment rather than a flicker.
    const holdLoading = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_LOADING_MS - (performance.now() - started))))
    try {
      const record = await runSubsystem(subsystem, files, { apiBase, useBackend: backendReady, onProgress: setProgress })
      await holdLoading()
      // Appended, never replacing an earlier run of the same subsystem — e.g. Door Fault tried with
      // 3 files, then again with 5, both stay reachable from "Past analysis".
      setRuns((prev) => [...prev, record])
      setActiveRunId(record.id)
      location.hash = '#/results'
      window.scrollTo({ top: 0 })
    } catch (err) {
      await holdLoading()
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
      setLoading(false)
    }
  }

  // The run the results page shows: the one just picked, or else the most recent.
  const runsByRecency = [...runs].sort((a, b) => b.finishedAt - a.finishedAt)
  const shownRun = runsByRecency.find((r) => r.id === activeRunId) ?? runsByRecency[0]

  // A freshly opened (or switched-to) run always starts on its own dashboard grid, not mid-chart.
  useEffect(() => {
    setOpenPanelId(null)
  }, [shownRun?.id])

  return (
    // The home page fits the window on wide screens (no page scroll); the console grows as it needs.
    <div className={view === 'home' ? 'flex h-full flex-col lg:overflow-hidden' : 'min-h-full'}>
      {/* The train waits at the station while you pick and upload, then pulls away with your files. */}
      <Backdrop atStation={view === 'console' && files.length === 0 && !loading} split={view === 'home'} />
      {/* On the console the scene softens behind a blur, so the panels read over it */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 -z-[5] transition-opacity duration-700 ${
          view !== 'home' && !loading ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      />
      {!loading && (
        <Header
          onHome={goHome}
          showHome={view === 'console'}
          showBackToAnalyse={view === 'results'}
          onBackToAnalyse={() => {
            location.hash = '#/app'
            window.scrollTo({ top: 0 })
          }}
          showBackToDashboard={view === 'results' && openPanelId !== null}
          onBackToDashboard={() => {
            setOpenPanelId(null)
            window.scrollTo({ top: 0 })
          }}
          runs={runs}
          onSelectRun={(id) => {
            setActiveRunId(id)
            location.hash = '#/results'
            window.scrollTo({ top: 0 })
          }}
        />
      )}

      {/* Loading: the train runs unobscured; just a small caption and a coloured bar float above it, high up so the MRT stays in clear view */}
      {loading && (
        <div className="fixed inset-x-0 top-[10vh] z-20 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
          <p className="display text-lg font-bold text-ink [text-shadow:0_1px_12px_var(--page-plane)]">
            Analysing {meta?.name ?? ''}
          </p>
          <div
            className="h-2 w-full max-w-xs overflow-hidden rounded-full"
            style={{ background: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
          >
            {progress && progress.total > 1 ? (
              // Several batches: the bar itself is the progress, filled with the brand gradient.
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                  background: 'linear-gradient(90deg, var(--series-1), var(--series-3))',
                }}
              />
            ) : etaPct !== null ? (
              // One request, but past runs of this subsystem give a real per-file rate to estimate from.
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${etaPct}%`,
                  background: 'linear-gradient(90deg, var(--series-1), var(--series-3))',
                }}
              />
            ) : (
              // No history for this subsystem yet — nothing honest to estimate from, so a segment sweeps across instead.
              <div
                className="load-indeterminate h-full w-1/3 rounded-full"
                style={{ background: 'linear-gradient(90deg, var(--series-1), var(--series-4), var(--series-3))' }}
              />
            )}
          </div>
          <p className="text-sm text-ink-secondary [text-shadow:0_1px_10px_var(--page-plane)]">
            {progress?.label ?? 'Working…'}
            {etaPct !== null && !(progress && progress.total > 1) && estimateMs !== null && (
              <> · ~{Math.round(etaPct)}% · {formatSeconds(Math.max(0, estimateMs - elapsedMs))} left</>
            )}
          </p>
        </div>
      )}

      {view === 'home' && !loading && <Home onStart={openConsole} />}

      {view === 'console' && !loading && (
      <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-2">
        <section className="pt-6 sm:pt-8">
          <div className="mb-7 text-center">
            <h1 className="display text-4xl font-black uppercase tracking-tight text-ink sm:text-5xl">Select a subsystem</h1>
            <p className="mt-2.5 inline-flex items-center gap-1.5 text-lg text-ink-secondary">
              Drop in train sensor data
              <InfoHint label="About privacy and processing">
                Files are sent to the model backend, scored by the trained models, then discarded. Every figure you
                see afterwards comes from the backend's answer.
              </InfoHint>
            </p>
            {/* Whether the trained models are reachable; analysis needs them */}
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-ink-secondary">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: health.reachable ? 'var(--status-good)' : 'var(--text-muted)' }}
              />
              {health.reachable ? 'Connected to the trained models' : 'Model backend offline — start it to analyse'}
              {!health.reachable && (
                <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => void recheck()}>
                  Retry
                </button>
              )}
            </p>
          </div>
          <SubsystemPicker
            active={subsystem}
            onSelect={(id) => {
              setSubsystem(id)
              setFiles([])
              setError(null)
            }}
          />
        </section>

        {meta && (
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="display flex items-center gap-1.5 text-xl font-bold tracking-tight text-ink">
                  {meta.name}
                  <InfoHint label={`About ${meta.name}`}>{meta.detail}</InfoHint>
                </h2>
                <p className="eyebrow mt-1">{meta.expects}</p>
              </div>
              <span
                className="rounded-full border border-hairline px-2.5 py-1 text-[0.68rem] tracking-wide text-ink-secondary"
                title={health.detail}
              >
                {backendReady ? 'Trained model ready' : 'Trained model offline'}
              </span>
            </div>

            <Dropzone meta={meta} files={files} onFiles={setFiles} />

            {!backendReady && (
              <p className="mt-4 rounded-lg border border-hairline px-3 py-2 text-xs text-ink-secondary">
                <strong className="text-ink">Needs the model backend</strong> · every result comes from the trained
                models. Start it with <code>python serve.py</code> in <code>backend/</code>, then Retry above.
              </p>
            )}

            <div className="mt-4 flex justify-center">
              <button
                type="button"
                className="btn-primary"
                disabled={files.length === 0 || progress !== null || !backendReady}
                onClick={onRun}
              >
                {progress ? 'Analysing…' : 'Analyse'}
              </button>
            </div>

            {error && (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
                style={{
                  borderColor: 'var(--status-critical)',
                  background: 'color-mix(in srgb, var(--status-critical) 8%, var(--surface-1))',
                  color: 'var(--status-critical)',
                }}
              >
                <span className="mt-0.5 shrink-0 text-base">
                  <AlertIcon />
                </span>
                <span className="whitespace-pre-line font-medium">{error}</span>
              </div>
            )}
          </section>
        )}

      </main>
      )}

      {view === 'results' && !loading && (
        <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-4">
          {/* "Back to analyse" now lives in the header, alongside "Past analysis"; the download stays here. */}
          {shownRun && (
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-ghost !px-3 !py-1.5 text-sm"
                onClick={() => downloadText(shownRun.csv.filename, shownRun.csv.content)}
              >
                <DownloadIcon />
                {shownRun.csv.filename}
              </button>
            </div>
          )}

          {shownRun ? (
            <section className="space-y-6">
              <div className="text-center">
                <h1 className="display text-3xl font-black uppercase tracking-tight text-ink sm:text-4xl">
                  {SUBSYSTEMS[shownRun.subsystem].name}
                </h1>
                <p className="mt-2 text-sm text-ink-muted">
                  {shownRun.engineLabel} · {shownRun.inputFiles.length} file{shownRun.inputFiles.length === 1 ? '' : 's'}
                </p>
              </div>

              <Dashboard run={shownRun} openPanelId={openPanelId} onOpenPanel={setOpenPanelId} />
            </section>
          ) : (
            <section className="card p-6 text-center">
              <p className="text-ink-secondary">No result yet. Pick a subsystem, drop in data and press Analyse.</p>
            </section>
          )}
        </main>
      )}
    </div>
  )
}
