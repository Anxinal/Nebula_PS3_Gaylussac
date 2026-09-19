import { useCallback, useEffect, useMemo, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { Home } from './components/Home'
import { InfoHint } from './components/InfoHint'
import { WhyPanel } from './components/results/WhyPanel'
import { DownloadIcon, AlertIcon } from './components/icons'
import { Header } from './components/Header'
import { SubsystemPicker } from './components/SubsystemPicker'
import { Dropzone } from './components/Dropzone'
import { SubmissionTray } from './components/SubmissionTray'
import { DoorResults } from './components/results/DoorResults'
import { AcvResults } from './components/results/AcvResults'
import { RailResults } from './components/results/RailResults'
import { ShmResults } from './components/results/ShmResults'
import { SUBSYSTEMS } from './subsystems'
import { checkHealth, getApiBase, type BackendHealth } from './lib/api'
import { runSubsystem, type RunProgress } from './lib/runner'
import { downloadText } from './lib/predictionCsv'
import { DEFAULT_CALIBRATION, type ShmCalibration } from './lib/engines/shm'
import type { RunRecord, SubsystemId } from './types'

const CAL_KEY = 'nebula-shm-calibration'

export default function App() {
  // Two views, addressable by hash so the back button and a shared link both work.
  const [view, setView] = useState<'home' | 'console'>(() =>
    typeof location !== 'undefined' && location.hash.startsWith('#/app') ? 'console' : 'home',
  )
  const [subsystem, setSubsystem] = useState<SubsystemId | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [runs, setRuns] = useState<Map<SubsystemId, RunRecord>>(new Map())
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A backend address saved earlier is still honoured; there is no longer a control to change it.
  const [apiBase] = useState(getApiBase)
  const [health, setHealth] = useState<BackendHealth>({ reachable: false, models: {}, detail: 'Using the built-in baselines.' })
  const [railSensitivity, setRailSensitivity] = useState(3)
  const [calibration, setCalibration] = useState<ShmCalibration>(loadCalibration)

  const recheck = useCallback(async () => {
    setHealth(await checkHealth(getApiBase()))
  }, [])

  useEffect(() => {
    void recheck()
  }, [recheck])

  useEffect(() => {
    const onHash = () => setView(location.hash.startsWith('#/app') ? 'console' : 'home')
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
        railSensitivity,
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
          view === 'console' ? 'opacity-100' : 'opacity-0'
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
            {/* Whether the trained models are reachable; the app falls back to the in-browser baselines if not */}
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-ink-secondary" aria-live="polite">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: health.reachable ? 'var(--status-good)' : 'var(--text-muted)' }}
              />
              {health.reachable ? 'Connected to the trained models' : 'Model backend offline — using in-browser baselines'}
              <InfoHint label="About the model backend">{health.detail}</InfoHint>
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

        {subsystem && activeRun && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="display text-2xl font-bold tracking-tight text-ink">{SUBSYSTEMS[subsystem].name} result</h2>
              <p className="text-xs text-ink-muted">
                {activeRun.engine === 'backend' ? 'Trained model' : 'Baseline'} · {activeRun.engineLabel}
              </p>
            </div>

            {activeRun.warnings.length > 0 && (
              <ul className="card space-y-1.5 px-4 py-3 text-xs text-ink-secondary">
                {activeRun.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            )}

            {activeRun.result.kind === 'door' && <DoorResults result={activeRun.result} />}
            {activeRun.result.kind === 'acv' && <AcvResults result={activeRun.result} />}
            {activeRun.result.kind === 'rail' && <RailResults result={activeRun.result} />}
            {activeRun.result.kind === 'shm' && (
              <ShmResults result={activeRun.result} calibrated={activeRun.engine === 'backend' || calibration.fittedAt > 0} />
            )}
            {activeRun.engine === 'backend' && <WhyPanel result={activeRun.result} />}
          </section>
        )}

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

            {subsystem === 'rail' && (
              <div className="mt-4 rounded-lg border border-hairline p-3">
                <label htmlFor="rail-sens" className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  Sensitivity
                  <InfoHint label="About sensitivity">
                    How far a recording's side imbalance must stand out from the rest of the batch before it is
                    called corrugated, measured in robust standard deviations (MAD). Lower catches more faults and
                    risks false alarms; higher only flags the clearest cases. Corrugation is the minority class, so
                    the default sits well out in the tail.
                  </InfoHint>
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="rail-sens"
                    type="range"
                    min={1}
                    max={5}
                    step={0.25}
                    value={railSensitivity}
                    onChange={(e) => setRailSensitivity(Number(e.target.value))}
                    className="w-56"
                  />
                  <span className="tnum text-xs text-ink-secondary">{railSensitivity.toFixed(2)} × MAD</span>
                </div>
              </div>
            )}

            {subsystem === 'shm' && (
              <p className="mt-4 rounded-lg border border-hairline px-3 py-2 text-xs text-ink-secondary">
                {calibration.fittedAt > 0 ? (
                  <>
                    <strong className="text-ink">Calibrated</strong> · m = {calibration.m.toFixed(2)} from{' '}
                    {calibration.fileCount} labelled file(s), training MAPE {(calibration.mape * 100).toFixed(1)}%.
                    Include a <code>Train_Labels.csv</code> to refit.
                  </>
                ) : (
                  <>
                    <strong className="text-ink">Not calibrated</strong> · drop the Train folder with{' '}
                    <code>Train_Labels.csv</code> once to fit the S-N curve.
                  </>
                )}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={files.length === 0 || progress !== null} onClick={onRun}>
                {progress ? 'Analysing…' : 'Analyse'}
              </button>
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
