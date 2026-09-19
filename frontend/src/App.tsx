import { useCallback, useEffect, useMemo, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { Home } from './components/Home'
import { InfoHint } from './components/InfoHint'
import { DownloadIcon, AlertIcon } from './components/icons'
import { Header } from './components/Header'
import { SubsystemPicker } from './components/SubsystemPicker'
import { Dropzone } from './components/Dropzone'
import { SubmissionTray } from './components/SubmissionTray'
import { Dashboard } from './components/dashboard/Dashboard'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from './subsystems'
import { checkHealth, getApiBase, type BackendHealth } from './lib/api'
import { runSubsystem, type RunProgress } from './lib/runner'
import { downloadText } from './lib/predictionCsv'
import type { RunRecord, SubsystemId } from './types'

// Short names for the result tabs, so all five fit across the page.
const TAB_LABEL: Record<SubsystemId, string> = {
  door: 'Door Fault',
  acv: 'Air Con (ACV)',
  rail: 'Rail Corrugation',
  shm: 'Structural Health (SHM)',
}

const MIN_LOADING_MS = 1000

type View = 'home' | 'console' | 'results'
const viewFromHash = (hash: string): View =>
  hash.startsWith('#/results') ? 'results' : hash.startsWith('#/app') ? 'console' : 'home'

export default function App() {
  // Three views, addressable by hash so the back button and a shared link both work:
  // the landing page, the upload console, and the results of the last analysis.
  const [view, setView] = useState<View>(() => (typeof location !== 'undefined' ? viewFromHash(location.hash) : 'home'))
  const [subsystem, setSubsystem] = useState<SubsystemId | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [runs, setRuns] = useState<Map<SubsystemId, RunRecord>>(new Map())
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which subsystem's result the results page shows.
  const [resultTab, setResultTab] = useState<SubsystemId | null>(null)

  // A backend address saved earlier is still honoured; there is no longer a control to change it.
  const [apiBase] = useState(getApiBase)
  const [health, setHealth] = useState<BackendHealth>({ reachable: false, models: {}, detail: 'Checking for the trained models…' })
  // While an analysis runs, the page clears to the moving train and a load bar.
  const [loading, setLoading] = useState(false)

  const recheck = useCallback(async () => {
    setHealth(await checkHealth(getApiBase()))
  }, [])

  useEffect(() => {
    void recheck()
  }, [recheck])

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
  const activeRun = subsystem ? runs.get(subsystem) : undefined
  const backendReady = health.reachable && subsystem !== null && health.models[subsystem] !== false

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
      setRuns((prev) => new Map(prev).set(subsystem, record))
      // Straight on to the results page once the analysis is in, on this subsystem's tab.
      setResultTab(subsystem)
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

  const completed = useMemo(() => new Set(runs.keys()), [runs])

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
      {!loading && <Header onHome={goHome} showHome={view === 'console'} />}

      {/* Loading: nothing but the train running and a load bar */}
      {loading && (
        <div className="fixed inset-x-0 bottom-[12vh] z-20 flex justify-center px-4" role="status" aria-live="polite">
          <div
            className="w-full max-w-md rounded-2xl px-6 py-5 text-center shadow-xl"
            style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(10px)' }}
          >
            <p className="display text-lg font-bold text-ink">Analysing {meta?.name ?? ''}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--series-1) 15%, transparent)' }}>
              {progress && progress.done > 0 ? (
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%`, background: 'var(--series-1)' }}
                />
              ) : (
                // The backend does not report partial progress, so until it answers the bar just runs.
                <div className="load-indeterminate h-full w-1/3 rounded-full" style={{ background: 'var(--series-1)' }} />
              )}
            </div>
            <p className="mt-2 text-sm text-ink-secondary">{progress?.label ?? 'Working…'}</p>
          </div>
        </div>
      )}

      {view === 'home' && !loading && <Home onStart={openConsole} />}

      {view === 'console' && !loading && (
      <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-2">
        <section>
          <div className="mb-7 text-center">
            <h1 className="display text-4xl font-black uppercase tracking-tight text-ink sm:text-5xl">Select a subsystem</h1>
            <p className="mt-2.5 inline-flex items-center gap-1.5 text-lg text-ink-secondary">
              Drop in train sensor data
              <InfoHint label="About privacy and processing">
                Files are sent to the model backend, scored by the trained models, then discarded. Every figure you
                see afterwards comes from the backend's answer.
              </InfoHint>
            </p>
            {/* What the backend reported (which models are ready, or why it could not be reached) */}
            <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
              {health.detail}
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
            completed={completed}
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
                  {activeRun ? `Run ${meta.name} again` : meta.name}
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

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={files.length === 0 || progress !== null || !backendReady}
                onClick={onRun}
              >
                {progress ? 'Analysing…' : 'Analyse'}
              </button>
              {activeRun && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    if (subsystem) setResultTab(subsystem)
                    location.hash = '#/results'
                  }}
                >
                  View result →
                </button>
              )}
              {activeRun && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => downloadText(activeRun.csv.filename, activeRun.csv.content)}
                >
                  <DownloadIcon />
                  {activeRun.csv.filename}
                </button>
              )}
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

        <SubmissionTray
          runs={runs}
          onOpen={(id) => {
            setSubsystem(id)
            setFiles([])
            setError(null)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      </main>
      )}

      {view === 'results' &&
        !loading &&
        (() => {
          // Show the chosen subsystem, or else the first one with a result.
          const shown = resultTab && runs.has(resultTab) ? resultTab : SUBSYSTEM_ORDER.find((id) => runs.has(id))
          const tabRun = shown ? runs.get(shown) : undefined
          const tabClass = (selected: boolean) =>
            `-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors
             disabled:cursor-not-allowed disabled:opacity-40 ${
               selected ? 'text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
             }`
          return (
            <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-2">
              {/* One row: the way back, a tab per subsystem, and this result's CSV at the far end */}
              <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline">
                <button type="button" className={tabClass(false)} onClick={() => (location.hash = '#/app')}>
                  <span aria-hidden>←</span> Back to analyse
                </button>
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-[var(--border-hairline)]" />
                <div role="tablist" aria-label="Results" className="flex gap-1">
                  {SUBSYSTEM_ORDER.map((id) => {
                    const selected = shown === id
                    const enabled = runs.has(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        disabled={!enabled}
                        title={enabled ? undefined : 'Not analysed yet'}
                        onClick={() => setResultTab(id)}
                        className={tabClass(selected)}
                        style={selected ? { borderColor: 'var(--series-1)' } : undefined}
                      >
                        {TAB_LABEL[id]}
                      </button>
                    )
                  })}
                </div>
                {tabRun && (
                  <button
                    type="button"
                    className="btn-ghost mb-1 ml-auto shrink-0 !px-3 !py-1.5 text-sm"
                    onClick={() => downloadText(tabRun.csv.filename, tabRun.csv.content)}
                  >
                    <DownloadIcon />
                    {tabRun.csv.filename}
                  </button>
                )}
              </div>

              {shown && tabRun ? (
                <section role="tabpanel" className="space-y-6">
                  <div className="text-center">
                    <h1 className="display text-3xl font-black uppercase tracking-tight text-ink sm:text-4xl">
                      {SUBSYSTEMS[shown].name}
                    </h1>
                    <p className="mt-2 text-sm text-ink-muted">
                      {tabRun.engineLabel} · {tabRun.inputFiles.length} file{tabRun.inputFiles.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  <Dashboard run={tabRun} />
                </section>
              ) : (
                <section className="card p-6 text-center">
                  <p className="text-ink-secondary">No result yet. Pick a subsystem, drop in data and press Analyse.</p>
                </section>
              )}
            </main>
          )
        })()}
    </div>
  )
}
