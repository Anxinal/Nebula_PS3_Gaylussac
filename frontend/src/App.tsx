import { useCallback, useEffect, useMemo, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { Home } from './components/Home'
import { InfoHint } from './components/InfoHint'
import { WhyPanel } from './components/results/WhyPanel'
import { Overview } from './components/results/Overview'
import { DownloadIcon, AlertIcon } from './components/icons'
import { Header } from './components/Header'
import { SubsystemPicker } from './components/SubsystemPicker'
import { Dropzone } from './components/Dropzone'
import { SubmissionTray } from './components/SubmissionTray'
import { DoorResults } from './components/results/DoorResults'
import { AcvResults } from './components/results/AcvResults'
import { RailResults } from './components/results/RailResults'
import { ShmResults } from './components/results/ShmResults'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from './subsystems'
import { checkHealth, getApiBase, type BackendHealth } from './lib/api'
import { runSubsystem, type RunProgress } from './lib/runner'
import { downloadText } from './lib/predictionCsv'
import { DEFAULT_CALIBRATION, type ShmCalibration } from './lib/engines/shm'
import type { RunRecord, SubsystemId } from './types'

const CAL_KEY = 'nebula-shm-calibration'

// Short names for the result tabs, so all five fit across the page.
const TAB_LABEL: Record<SubsystemId, string> = {
  door: 'Door Fault',
  acv: 'Air Con (ACV)',
  rail: 'Rail Corrugation',
  shm: 'Structural Health (SHM)',
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
  const [runs, setRuns] = useState<Map<SubsystemId, RunRecord>>(new Map())
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which tab the results page shows: the fleet overview, or one subsystem's full result.
  const [resultTab, setResultTab] = useState<'overview' | SubsystemId>('overview')

  // A backend address saved earlier is still honoured; there is no longer a control to change it.
  const [apiBase] = useState(getApiBase)
  const [health, setHealth] = useState<BackendHealth>({ reachable: false, models: {}, detail: 'Using the built-in baselines.' })
  const [calibration, setCalibration] = useState<ShmCalibration>(loadCalibration)

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
    setProgress({ done: 0, total: files.length || 1, label: 'Starting…' })
    try {
      const record = await runSubsystem(subsystem, files, {
        apiBase,
        useBackend: backendReady,
        shmCalibration: calibration,
        onProgress: setProgress,
        onCalibrated: (c) => {
          setCalibration(c)
          try {
            localStorage.setItem(CAL_KEY, JSON.stringify(c))
          } catch {
            // Storage blocked; the calibration still applies to this run.
          }
        },
      })
      setRuns((prev) => new Map(prev).set(subsystem, record))
      // Straight on to the results page once the analysis is in, on this subsystem's tab.
      setResultTab(subsystem)
      location.hash = '#/results'
      window.scrollTo({ top: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  const completed = useMemo(() => new Set(runs.keys()), [runs])

  return (
    // The home page fits the window on wide screens (no page scroll); the console grows as it needs.
    <div className={view === 'home' ? 'flex h-full flex-col lg:overflow-hidden' : 'min-h-full'}>
      {/* The train waits at the station while you pick and upload, then pulls away with your files. */}
      <Backdrop atStation={view === 'console' && files.length === 0} split={view === 'home'} />
      {/* On the console the scene softens behind a blur, so the panels read over it */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 -z-[5] transition-opacity duration-700 ${
          view !== 'home' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      />
      <Header onHome={goHome} showHome={view === 'console'} />

      {view === 'home' && <Home onStart={openConsole} />}

      {view === 'console' && (
      <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section className="pt-6 sm:pt-10">
          <div className="mb-7 text-center">
            <h1 className="display text-4xl font-black uppercase tracking-tight text-ink sm:text-5xl">Select a subsystem</h1>
            <p className="mt-2.5 inline-flex items-center gap-1.5 text-lg text-ink-secondary">
              Drop in train sensor data
              <InfoHint label="About privacy and processing">
                {health.reachable
                  ? 'Files are sent to the connected model backend to be scored by the trained models, then discarded.'
                  : 'Files never leave your device. Parsing, feature extraction and the prediction all run in this browser tab.'}
              </InfoHint>
            </p>
            {/* What the backend reported (which models are ready, or why it could not be reached) */}
            <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
              {health.detail}
            </p>
            {/* Whether the trained models are reachable; the app falls back to the in-browser baselines if not */}
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-ink-secondary">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: health.reachable ? 'var(--status-good)' : 'var(--text-muted)' }}
              />
              {health.reachable ? 'Connected to the trained models' : 'Model backend offline — using in-browser baselines'}
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
                title={backendReady ? health.detail : 'Transparent rule baseline running in your browser'}
              >
                {backendReady ? 'Trained model' : 'Baseline'}
              </span>
            </div>

            <Dropzone meta={meta} files={files} onFiles={setFiles} />

            {/* Damage figures come only from the trained model; there is no in-browser estimate for SHM. */}
            {subsystem === 'shm' && (
              <p className="mt-4 rounded-lg border border-hairline px-3 py-2 text-xs text-ink-secondary">
                {backendReady ? (
                  <>
                    <strong className="text-ink">Scored by the trained model</strong> · every damage figure and chart
                    comes from the backend.
                  </>
                ) : (
                  <>
                    <strong className="text-ink">Needs the model backend</strong> · damage is only computed by the
                    trained model. Start it with <code>python serve.py</code> in <code>backend/</code>, then Retry above.
                  </>
                )}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={files.length === 0 || progress !== null || (subsystem === 'shm' && !backendReady)}
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

            {progress && (
              <div className="mt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--page-plane)' }}>
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                      background: 'var(--series-1)',
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-secondary">{progress.label}</p>
              </div>
            )}

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
        (() => {
          const tabRun = resultTab === 'overview' ? undefined : runs.get(resultTab)
          const tabs: { id: 'overview' | SubsystemId; label: string; enabled: boolean }[] = [
            { id: 'overview', label: 'Fleet overview', enabled: true },
            ...SUBSYSTEM_ORDER.map((id) => ({ id, label: TAB_LABEL[id], enabled: runs.has(id) })),
          ]
          return (
            <main className="fade-in mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => (location.hash = '#/app')}>
                  <span aria-hidden>←</span> Back to analyse
                </button>
                {tabRun && (
                  <button
                    type="button"
                    className="btn-ghost !px-3 !py-1.5 text-sm"
                    onClick={() => downloadText(tabRun.csv.filename, tabRun.csv.content)}
                  >
                    <DownloadIcon />
                    {tabRun.csv.filename}
                  </button>
                )}
              </div>

              {/* Tabs across the top: the overview, then each subsystem that has a result */}
              <div role="tablist" aria-label="Results" className="flex gap-1 overflow-x-auto border-b border-hairline">
                {tabs.map((t) => {
                  const selected = resultTab === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      disabled={!t.enabled}
                      title={t.enabled ? undefined : 'Not analysed yet'}
                      onClick={() => setResultTab(t.id)}
                      className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors
                                  disabled:cursor-not-allowed disabled:opacity-40 ${
                                    selected ? 'text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
                                  }`}
                      style={selected ? { borderColor: 'var(--series-1)' } : undefined}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>

              {resultTab === 'overview' || !tabRun ? (
                <Overview
                  runs={runs}
                  onOpen={setResultTab}
                  onAnalyse={(id) => {
                    setSubsystem(id)
                    setFiles([])
                    setError(null)
                    location.hash = '#/app'
                  }}
                />
              ) : (
                <section role="tabpanel" className="space-y-6">
                  <div className="text-center">
                    <h1 className="display text-3xl font-black uppercase tracking-tight text-ink sm:text-4xl">
                      {SUBSYSTEMS[resultTab].name}
                    </h1>
                    <p className="mt-2 text-sm text-ink-muted">
                      {tabRun.engine === 'backend' ? 'Trained model' : 'Baseline'} · {tabRun.engineLabel} ·{' '}
                      {tabRun.inputFiles.length} file{tabRun.inputFiles.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  {tabRun.warnings.length > 0 && (
                    <ul className="card space-y-1.5 px-4 py-3 text-xs text-ink-secondary">
                      {tabRun.warnings.map((w, i) => (
                        <li key={i}>· {w}</li>
                      ))}
                    </ul>
                  )}

                  {tabRun.result.kind === 'door' && <DoorResults result={tabRun.result} />}
                  {tabRun.result.kind === 'acv' && <AcvResults result={tabRun.result} />}
                  {tabRun.result.kind === 'rail' && <RailResults result={tabRun.result} />}
                  {tabRun.result.kind === 'shm' && <ShmResults result={tabRun.result} />}

                  {/* The model's reasoning goes last, under the data it explains */}
                  {tabRun.engine === 'backend' && <WhyPanel result={tabRun.result} />}
                </section>
              )}
            </main>
          )
        })()}
    </div>
  )
}

function loadCalibration(): ShmCalibration {
  try {
    const raw = localStorage.getItem(CAL_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ShmCalibration
      if (Number.isFinite(parsed.m) && Number.isFinite(parsed.C)) return parsed
    }
  } catch {
    // Unreadable or blocked storage — start from the defaults.
  }
  return DEFAULT_CALIBRATION
}
