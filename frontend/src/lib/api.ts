import type {
  AcvResult,
  DoorResult,
  Explanation,
  RailResult,
  ShmResult,
  SubsystemId,
  SubsystemResult,
} from '../types'

/**
 * Model-backend client.
 *
 * The app runs standalone on its in-browser baselines, and switches to the
 * team's trained models as soon as a backend is reachable. Point it at one with
 * VITE_API_BASE_URL at build time; in development it looks for the backend's
 * default address, http://localhost:8000 (`python serve.py` in backend/).
 *
 * Contract the backend must implement — see frontend/README.md:
 *   GET  {base}/health                  -> { "status": "ok", "models": { "door": true, ... } }
 *   POST {base}/predict/{subsystem}     multipart/form-data, field "files" (repeatable)
 *        door -> { "segments": [ { "start_time", "end_time", "prediction" }, ... ] }
 *        acv  -> { "files": [ { "file_id", "ranked_cars": ["03","01",...] }, ... ] }
 *        rail -> { "files": [ { "file_id", "prediction", "confidence"? }, ... ] }
 *        shm  -> { "files": [ { "file_id", "prediction" }, ... ] }
 */

const STORAGE_KEY = 'nebula-api-base'

export function getApiBase(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored
  } catch {
    // Private mode or blocked storage — fall through to the build-time value.
  }
  return import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? DEV_BACKEND : '')
}

/** Where `python serve.py` listens by default. */
const DEV_BACKEND = 'http://localhost:8000'

export function setApiBase(value: string) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not fatal: the value still applies for this page load via the caller's state.
  }
}

export interface BackendHealth {
  reachable: boolean
  models: Partial<Record<SubsystemId, boolean>>
  detail: string
}

const trimBase = (base: string) => base.replace(/\/+$/, '')

export async function checkHealth(base: string, timeoutMs = 4000): Promise<BackendHealth> {
  if (!base) return { reachable: false, models: {}, detail: 'No backend configured.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${trimBase(base)}/health`, { signal: controller.signal })
    if (!res.ok) return { reachable: false, models: {}, detail: `Backend replied ${res.status}.` }
    const body = (await res.json()) as { models?: Partial<Record<SubsystemId, boolean>> }
    const models = body.models ?? {}
    const ready = Object.entries(models)
      .filter(([, v]) => v)
      .map(([k]) => k)
    return {
      reachable: true,
      models,
      detail: ready.length > 0 ? `Models ready: ${ready.join(', ')}.` : 'Connected, no models reported.',
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    return {
      reachable: false,
      models: {},
      detail: aborted ? 'Backend did not respond in time.' : 'Could not reach the backend.',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function predictViaBackend(
  base: string,
  subsystem: SubsystemId,
  files: File[],
): Promise<SubsystemResult> {
  const form = new FormData()
  for (const f of files) form.append('files', f, f.name)

  const res = await fetch(`${trimBase(base)}/predict/${subsystem}`, { method: 'POST', body: form })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Backend returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  const body = await res.json()
  return normalise(subsystem, body)
}

/** The backend's snake_case explanation, or undefined when it sent none. */
function toExplanation(raw: any): Explanation | undefined {
  if (!raw || typeof raw !== 'object' || !raw.plain_summary) return undefined
  return {
    plainSummary: String(raw.plain_summary),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String) : [],
    topNodes: (raw.top_nodes ?? []).map((n: any) => ({
      plain: String(n.plain ?? ''),
      rule: String(n.rule ?? ''),
      contribution: Number(n.contribution ?? 0),
      nTrees: n.n_trees,
    })),
    note: raw.units_note || undefined,
  }
}

function normalise(subsystem: SubsystemId, body: any): SubsystemResult {
  switch (subsystem) {
    case 'door': {
      const segments = (body.segments ?? []).map((s: any) => ({
        startTime: String(s.start_time ?? s.startTime),
        endTime: String(s.end_time ?? s.endTime),
        prediction: s.prediction === 'Abnormal resistance' ? 'Abnormal resistance' : 'Normal',
        operation: s.operation,
        meanCurrent: s.mean_current ?? s.meanCurrent,
        margin: s.margin,
        rowCount: s.n_rows ?? s.rowCount,
        startOffsetSec: s.start_offset_sec,
        endOffsetSec: s.end_offset_sec,
        explanation: toExplanation(s.explanation),
      }))
      const result: DoorResult = {
        kind: 'door',
        segments,
        trace: body.trace ?? [],
        totalRows: body.total_rows ?? 0,
        durationSec: body.duration_sec ?? 0,
        summary: body.summary,
        explanation: toExplanation(body.explanation),
      }
      return result
    }
    case 'acv': {
      const result: AcvResult = {
        kind: 'acv',
        files: (body.files ?? []).map((f: any) => {
          const ranked: string[] = f.ranked_cars ?? f.rankedCars ?? []
          return {
            fileId: String(f.file_id ?? f.fileId),
            cars: ranked.map((car, i) => ({
              car: String(car),
              score: Number(f.scores?.[car] ?? ranked.length - i),
              rank: i + 1,
              evidence: f.evidence?.[car] ?? 'Ranked by the model backend',
            })),
            series: f.series ?? [],
            sampleCount: f.sample_count ?? 0,
            explanation: toExplanation(f.explanation),
          }
        }),
      }
      return result
    }
    case 'rail': {
      const result: RailResult = {
        kind: 'rail',
        files: (body.files ?? []).map((f: any) => ({
          fileId: String(f.file_id ?? f.fileId),
          prediction: f.prediction,
          confidence: Number(f.confidence ?? 1),
          sideI: Number(f.side_i ?? 0),
          sideII: Number(f.side_ii ?? 0),
          rowCount: Number(f.n_rows ?? 0),
          speedKmh: f.speed_kmh ?? null,
          explanation: toExplanation(f.explanation),
        })),
      }
      return result
    }
    case 'shm': {
      const result: ShmResult = {
        kind: 'shm',
        files: (body.files ?? []).map((f: any) => ({
          fileId: String(f.file_id ?? f.fileId),
          prediction: Number(f.prediction),
          cycles: Number(f.cycles ?? 0),
          maxRange: Number(f.max_range ?? 0),
          bins: f.bins ?? [],
          explanation: toExplanation(f.explanation),
        })),
      }
      return result
    }
  }
}
