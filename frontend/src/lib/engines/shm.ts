import type { ShmFileResult } from '../../types'

/**
 * SHM baseline — rainflow counting + Miner's linear cumulative damage rule.
 *
 * This is the same method the info kit says the reference damage values were
 * produced with, so the app reproduces the physics rather than approximating it
 * with generic time-series features:
 *
 *   1. Reduce the stress history to its turning points.
 *   2. Extract closed cycles with the ASTM three-point rainflow algorithm
 *      (half cycles from the residue count as 0.5).
 *   3. Damage  D = (1/C) * SUM n_i * sigma_a,i^m   from the S-N curve
 *      sigma_a^m * N = C.
 *
 * `m` and `C` are material constants that the info kit does not publish, so the
 * app calibrates them: drop the training files together with Train_Labels.csv and
 * it fits (m, C) to minimise MAPE — the exact metric PS3 scores SHM on — then
 * reuses that calibration on the test files. Without a calibration the app still
 * reports a damage index, and says plainly that it is uncalibrated.
 */
export const SHM_BASELINE_LABEL = 'rainflow + Miner\u2019s rule'

export interface Cycle {
  /** Stress amplitude (half the range). */
  amplitude: number
  /** 1 for a closed cycle, 0.5 for a residual half cycle. */
  count: number
}

export interface ShmCalibration {
  m: number
  C: number
  /** MAPE achieved on the calibration set, as a fraction. */
  mape: number
  fileCount: number
  fittedAt: number
}

export const DEFAULT_CALIBRATION: ShmCalibration = {
  // Typical welded-steel slope; C is a pure scale factor and is the parameter
  // calibration actually pins down.
  m: 5,
  C: 1e18,
  mape: NaN,
  fileCount: 0,
  fittedAt: 0,
}

/** Keep only the local maxima/minima — rainflow is defined on turning points. */
function turningPoints(series: Float64Array): number[] {
  const tp: number[] = []
  let prev = NaN
  for (let i = 0; i < series.length; i++) {
    const v = series[i]
    if (!Number.isFinite(v)) continue
    if (tp.length === 0) {
      tp.push(v)
      prev = v
      continue
    }
    if (v === prev) continue
    if (tp.length === 1) {
      tp.push(v)
      prev = v
      continue
    }
    const a = tp[tp.length - 2]
    const b = tp[tp.length - 1]
    // If v continues the same direction as a->b, b was not a turning point.
    if ((b - a) * (v - b) > 0) tp[tp.length - 1] = v
    else tp.push(v)
    prev = v
  }
  return tp
}

/** ASTM E1049 three-point rainflow counting. */
export function rainflow(series: Float64Array): Cycle[] {
  const points = turningPoints(series)
  const cycles: Cycle[] = []
  const stack: number[] = []

  for (const point of points) {
    stack.push(point)
    while (stack.length >= 3) {
      const n = stack.length
      const x = Math.abs(stack[n - 1] - stack[n - 2])
      const y = Math.abs(stack[n - 2] - stack[n - 3])
      if (x < y) break
      if (n - 3 === 0) {
        // Range y still contains the start of the record, so only half of it has
        // been traversed: count 0.5 and drop just the start point (ASTM E1049).
        cycles.push({ amplitude: y / 2, count: 0.5 })
        stack.shift()
      } else {
        // A fully closed hysteresis loop; remove the two points that formed it.
        cycles.push({ amplitude: y / 2, count: 1 })
        stack.splice(n - 3, 2)
      }
    }
  }

  // Whatever is left over is the residue: half cycles.
  for (let i = 0; i + 1 < stack.length; i++) {
    cycles.push({ amplitude: Math.abs(stack[i + 1] - stack[i]) / 2, count: 0.5 })
  }
  return cycles.filter((c) => c.amplitude > 0)
}

/** SUM n_i * sigma_a,i^m — the part of Miner's rule that does not depend on C. */
export function damageIndex(cycles: Cycle[], m: number): number {
  let sum = 0
  for (const c of cycles) sum += c.count * Math.pow(c.amplitude, m)
  return sum
}

export interface ShmFileFeatures {
  fileId: string
  cycles: Cycle[]
  maxRange: number
  cycleCount: number
  channelCount: number
  samples: number
}

/**
 * Parse one stress file. Every numeric column is treated as a monitoring point;
 * cycles from all points are pooled, so the file's damage reflects its whole
 * measured cross-section rather than an arbitrarily chosen channel.
 */
export function extractShmFeatures(fileId: string, text: string): ShmFileFeatures {
  const lines = text.split(/\r?\n/)
  const columns: number[][] = []
  let samples = 0

  for (const line of lines) {
    if (line.length === 0) continue
    const cells = line.split(',')
    const values = cells.map((c) => Number(c))
    if (values.every((v) => !Number.isFinite(v))) continue // header row
    if (columns.length === 0) for (let i = 0; i < values.length; i++) columns.push([])
    for (let i = 0; i < Math.min(values.length, columns.length); i++) {
      if (Number.isFinite(values[i])) columns[i].push(values[i])
    }
    samples++
  }

  if (samples === 0) throw new Error(`${fileId}: no numeric rows found.`)

  // Drop columns that are constant or monotonic indices (a time or sample column
  // carries no stress and would otherwise contribute one enormous half cycle).
  const stressColumns = columns.filter((col) => {
    if (col.length < 4) return false
    let increasing = true
    for (let i = 1; i < col.length; i++) {
      if (col[i] <= col[i - 1]) {
        increasing = false
        break
      }
    }
    if (increasing) return false
    const min = Math.min(...col)
    const max = Math.max(...col)
    return max - min > 0
  })

  if (stressColumns.length === 0) throw new Error(`${fileId}: no varying stress channel found.`)

  const all: Cycle[] = []
  let maxRange = 0
  for (const col of stressColumns) {
    const cs = rainflow(Float64Array.from(col))
    for (const c of cs) {
      all.push(c)
      if (c.amplitude * 2 > maxRange) maxRange = c.amplitude * 2
    }
  }

  return {
    fileId,
    cycles: all,
    maxRange,
    cycleCount: all.reduce((a, c) => a + c.count, 0),
    channelCount: stressColumns.length,
    samples,
  }
}

/**
 * Fit (m, C) to labelled files by direct search on MAPE — the metric SHM is
 * scored on — rather than on squared error, which would let the largest damage
 * values dominate the fit.
 */
export function calibrate(
  features: ShmFileFeatures[],
  labels: Map<string, number>,
): ShmCalibration | null {
  const pairs = features
    .map((f) => ({ f, truth: labels.get(f.fileId) }))
    .filter((p): p is { f: ShmFileFeatures; truth: number } => typeof p.truth === 'number' && p.truth > 0)
  if (pairs.length < 2) return null

  let best: ShmCalibration | null = null
  for (let m = 3; m <= 9.001; m += 0.25) {
    // predicted = A/C, so A/truth is the C that would make this file exact.
    const ratios = pairs.map((p) => damageIndex(p.f.cycles, m) / p.truth)
    if (ratios.some((r) => !Number.isFinite(r) || r <= 0)) continue

    // The optimal C is one of the per-file ratios or close to it; evaluate each
    // candidate plus refinements between neighbours.
    const sorted = [...ratios].sort((a, b) => a - b)
    const candidates = new Set(sorted)
    for (let i = 1; i < sorted.length; i++) candidates.add(Math.sqrt(sorted[i - 1] * sorted[i]))

    for (const C of candidates) {
      let err = 0
      for (let i = 0; i < ratios.length; i++) err += Math.abs(1 - ratios[i] / C)
      const mape = err / ratios.length
      if (!best || mape < best.mape) {
        best = { m, C, mape, fileCount: pairs.length, fittedAt: Date.now() }
      }
    }
  }
  return best
}

export function predictShm(f: ShmFileFeatures, cal: ShmCalibration): ShmFileResult {
  const A = damageIndex(f.cycles, cal.m)
  const prediction = A / cal.C

  // Group cycles into range bins so the UI can show where the damage came from.
  const BINS = 12
  const maxAmp = f.maxRange / 2 || 1
  const binned = Array.from({ length: BINS }, (_, i) => ({
    rangeMid: ((i + 0.5) / BINS) * f.maxRange,
    cycles: 0,
    damage: 0,
  }))
  for (const c of f.cycles) {
    const i = Math.min(BINS - 1, Math.floor((c.amplitude / maxAmp) * BINS))
    binned[i].cycles += c.count
    binned[i].damage += (c.count * Math.pow(c.amplitude, cal.m)) / cal.C
  }

  return {
    fileId: f.fileId,
    prediction,
    cycles: f.cycleCount,
    maxRange: f.maxRange,
    bins: binned,
  }
}

/** Read a Train_Labels.csv-style file into filename -> damage. */
export function parseShmLabels(text: string): Map<string, number> {
  const map = new Map<string, number>()
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return map
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const nameIdx = header.findIndex((h) => h === 'filename' || h === 'file_id')
  const valueIdx = header.findIndex((h) => h === 'damage' || h === 'prediction' || h === 'value')
  const start = nameIdx >= 0 && valueIdx >= 0 ? 1 : 0
  const ni = nameIdx >= 0 ? nameIdx : 0
  const vi = valueIdx >= 0 ? valueIdx : 1
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(',')
    const name = (cells[ni] ?? '').trim()
    const value = Number(cells[vi])
    if (name && Number.isFinite(value)) map.set(name, value)
  }
  return map
}

export function looksLikeLabelsFile(name: string): boolean {
  return /labels?\.csv$/i.test(name.trim())
}
