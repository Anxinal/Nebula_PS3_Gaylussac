import type { RailFileResult, RailLabel } from '../../types'

/**
 * Rail corrugation baseline — side-vs-side vibration energy, thresholded against
 * the batch.
 *
 * Layout (from the info kit): column 1 is the toothed-wheel speed pulse; columns
 * 2..129 are 64 axle boxes as (vibration, shock) pairs, ordered car 1 position 1
 * through car 8 position 8. Odd positions (1,3,5,7) ride the Side I rail, even
 * positions (2,4,6,8) ride Side II.
 *
 * Corrugation excites the wheel-rail contact resonance, so the axle boxes on the
 * corrugated side carry more vibration energy than those on the healthy side of
 * the same recording. Comparing the two sides *within* a file cancels the
 * confounders the info kit warns about — train speed, ballast noise, overall
 * track roughness — because both sides share them.
 *
 * Because no absolute calibration is published, the decision threshold is derived
 * from the uploaded batch itself: files whose side imbalance is a robust outlier
 * (median + k x MAD, on the batch) are called corrugated on the louder side, and
 * everything else Normal. That suits the test folder, where corrugation is the
 * documented minority class. `sensitivity` is k, fixed at 3: well out in the tail.
 *
 * This is a transparent rule baseline, not a trained model.
 */
export const RAIL_BASELINE_LABEL = 'side-vs-side axle-box energy'

const SPEED_COL = 0
const CHANNELS = 128
const TEETH = 90
const WHEEL_DIAMETER_M = 0.85

export interface RailFeatures {
  fileId: string
  /** log-ratio of Side I to Side II vibration energy; >0 means Side I is louder. */
  imbalance: number
  rmsI: number
  rmsII: number
  rowCount: number
  speedKmh: number | null
}

/** Column index of the vibration channel for a given car (0-7) and position (0-7). */
function vibrationColumn(car: number, position: number): number {
  return 1 + car * 16 + position * 2
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Stream the file accumulating per-channel sums of squares. The matrix is never
 * materialised — a 10,000 x 129 file is 1.3M numbers, and a whole test folder
 * would not fit comfortably in memory if each file were kept.
 */
export function extractRailFeatures(fileId: string, text: string): RailFeatures {
  const sumSq = new Float64Array(CHANNELS + 1)
  let rowCount = 0
  let speedTransitions = 0
  let lastSpeed = NaN
  let widthWarned = 0

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (line.length === 0) continue
    const cells = line.split(',')
    if (cells.length < 2) continue

    const first = Number(cells[SPEED_COL])
    if (!Number.isFinite(first)) continue // header row, or a non-numeric line

    if (cells.length > widthWarned) widthWarned = cells.length

    // Speed pulse: count 0<->1 transitions of the toothed-wheel sensor.
    if (Number.isFinite(lastSpeed) && first !== lastSpeed) speedTransitions++
    lastSpeed = first

    const n = Math.min(cells.length, CHANNELS + 1)
    for (let c = 1; c < n; c++) {
      const v = Number(cells[c])
      if (Number.isFinite(v)) sumSq[c] += v * v
    }
    rowCount++
  }

  if (rowCount === 0) throw new Error(`${fileId}: no numeric rows found.`)
  if (widthWarned < CHANNELS + 1) {
    throw new Error(
      `${fileId}: expected ${CHANNELS + 1} columns (speed + 64 axle boxes x 2), found ${widthWarned}.`,
    )
  }

  const rmsOf = (col: number) => Math.sqrt(sumSq[col] / rowCount)
  const sideI: number[] = []
  const sideII: number[] = []
  for (let car = 0; car < 8; car++) {
    for (let pos = 0; pos < 8; pos++) {
      const rms = rmsOf(vibrationColumn(car, pos))
      // Position index 0,2,4,6 == positions 1,3,5,7 == Side I.
      if (pos % 2 === 0) sideI.push(rms)
      else sideII.push(rms)
    }
  }

  // Median across the 32 channels of a side: one dead or saturated sensor must
  // not decide the call.
  const rmsI = median(sideI)
  const rmsII = median(sideII)

  // Duration is 1 s per file at 10 kHz; each tooth yields two transitions.
  const revolutions = speedTransitions / (TEETH * 2)
  const durationSec = rowCount / 10000
  const speedKmh =
    durationSec > 0 && speedTransitions > 0
      ? ((revolutions / durationSec) * Math.PI * WHEEL_DIAMETER_M * 3600) / 1000
      : null

  const EPS = 1e-12
  return {
    fileId,
    imbalance: Math.log((rmsI + EPS) / (rmsII + EPS)),
    rmsI,
    rmsII,
    rowCount,
    speedKmh,
  }
}

/** Turn a batch of per-file features into labelled predictions. */
export function classifyRailBatch(features: RailFeatures[], sensitivity = 3): RailFileResult[] {
  const values = features.map((f) => f.imbalance)
  const med = median(values)
  const mad = median(values.map((v) => Math.abs(v - med)))
  // 1.4826 rescales MAD to a standard-deviation equivalent for normal data.
  const scale = mad * 1.4826 || 1e-6
  const cutoff = sensitivity * scale

  return features.map((f) => {
    const deviation = f.imbalance - med
    let prediction: RailLabel = 'Normal'
    if (deviation > cutoff) prediction = 'Side I'
    else if (deviation < -cutoff) prediction = 'Side II'

    // How far past the cutoff the file sits, squashed into 0..1 for display.
    const excess = Math.abs(deviation) / (cutoff || 1)
    const confidence =
      prediction === 'Normal'
        ? Math.min(1, 1 - excess * 0.5)
        : Math.min(1, 0.5 + (excess - 1) * 0.5)

    return {
      fileId: f.fileId,
      prediction,
      confidence: Math.max(0.05, confidence),
      sideI: f.rmsI,
      sideII: f.rmsII,
      rowCount: f.rowCount,
      speedKmh: f.speedKmh,
    }
  })
}
