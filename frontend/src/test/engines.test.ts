/**
 * Engine checks. Run with `npm test`.
 *
 * The Door checks run against the real Train.csv/Test.csv in the problem-statement
 * repo (small enough to be tracked in git); if that folder is absent they are
 * skipped rather than failed, so the suite still runs on a clean checkout.
 * Rail and SHM are checked against synthetic signals and published worked
 * examples, since their datasets are too large to track.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runDoorBaseline } from '../lib/engines/door'
import { classifyRailBatch, extractRailFeatures } from '../lib/engines/rail'
import { calibrate, damageIndex, extractShmFeatures, rainflow } from '../lib/engines/shm'
import { buildPredictionCsv } from '../lib/predictionCsv'
import type { DoorSegment } from '../types'

const here = dirname(fileURLToPath(import.meta.url))
const DOOR_DIR = resolve(
  here,
  '../../../NebulaX-Hackathon-ProblemStatement/PS3/02_Datasets/Door',
)

let failures = 0
let skipped = 0

function check(name: string, passed: boolean, detail = '') {
  if (!passed) failures++
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function skip(name: string, why: string) {
  skipped++
  console.log(`skip  ${name} — ${why}`)
}

// ---------------------------------------------------------------- Door -----

if (!existsSync(`${DOOR_DIR}/Train.csv`)) {
  skip('Door checks', 'dataset folder not found')
} else {
  const train = runDoorBaseline(readFileSync(`${DOOR_DIR}/Train.csv`, 'utf8'))
  const truth = readFileSync(`${DOOR_DIR}/Train_Segments_Answer.csv`, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','))

  check('Door finds every labelled cycle in Train.csv', train.result.segments.length === truth.length,
    `${train.result.segments.length} of ${truth.length}`)

  const boundaryErrors = train.result.segments.filter(
    (s, i) => s.startTime !== truth[i][1] || s.endTime !== truth[i][2],
  ).length
  check('Door segment boundaries match ground truth exactly', boundaryErrors === 0, `${boundaryErrors} mismatched`)

  const labelErrors = train.result.segments.filter((s, i) => s.prediction !== truth[i][4]).length
  check('Door classifies every training cycle correctly', labelErrors === 0, `${labelErrors} wrong`)

  const opErrors = train.result.segments.filter((s, i) => s.operation !== truth[i][3]).length
  check('Door infers Open/Close correctly', opErrors === 0, `${opErrors} wrong`)

  const f1 = iouWeightedF1(train.result.segments, truth)
  check('Door IoU-weighted F1 on Train.csv is 1.0', Math.abs(f1 - 1) < 1e-9, f1.toFixed(6))

  if (existsSync(`${DOOR_DIR}/Test.csv`)) {
    const test = runDoorBaseline(readFileSync(`${DOOR_DIR}/Test.csv`, 'utf8'))
    check('Door processes the unlabelled Test stream', test.result.segments.length > 0,
      `${test.result.segments.length} cycles, ` +
        `${test.result.segments.filter((s) => s.prediction === 'Abnormal resistance').length} abnormal`)

    const csv = buildPredictionCsv('door', test.result)
    const lines = csv.content.trim().split('\n')
    check('door_predictions.csv uses the PS3 header', lines[0] === 'start_time,end_time,prediction', lines[0])
    check('door_predictions.csv has one row per predicted segment',
      lines.length - 1 === test.result.segments.length)
    check('Door timestamps are written in the dataset’s native format',
      /^\d{4}(-\d+){6},\d{4}(-\d+){6},(Normal|Abnormal resistance)$/.test(lines[1]), lines[1])
  } else {
    skip('Door Test.csv checks', 'Test.csv not found')
  }
}

// ---------------------------------------------------------------- Rail -----
{
  // 129 columns: speed pulse, then 64 axle boxes as (vibration, shock) pairs.
  // Positions 1,3,5,7 -> Side I; 2,4,6,8 -> Side II.
  const makeRailFile = (sideIGain: number, sideIIGain: number, rows = 400) => {
    const out: string[] = []
    let rng = 42
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
    for (let r = 0; r < rows; r++) {
      const cells: string[] = [String(r % 2)] // toothed-wheel pulse
      for (let car = 0; car < 8; car++) {
        for (let pos = 0; pos < 8; pos++) {
          const gain = pos % 2 === 0 ? sideIGain : sideIIGain
          cells.push((rand() * gain).toFixed(4)) // vibration
          cells.push((rand() * gain).toFixed(4)) // shock
        }
      }
      out.push(cells.join(','))
    }
    return out.join('\n')
  }

  const files = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `normal${i}.csv`, text: makeRailFile(1, 1) })),
    { id: 'sideI.csv', text: makeRailFile(4, 1) },
    { id: 'sideII.csv', text: makeRailFile(1, 4) },
  ]
  const features = files.map((f) => extractRailFeatures(f.id, f.text))
  const predictions = classifyRailBatch(features, 3)
  const byId = new Map(predictions.map((p) => [p.fileId, p.prediction]))

  check('Rail flags the Side I file', byId.get('sideI.csv') === 'Side I', String(byId.get('sideI.csv')))
  check('Rail flags the Side II file', byId.get('sideII.csv') === 'Side II', String(byId.get('sideII.csv')))
  check('Rail leaves balanced recordings Normal',
    predictions.filter((p) => p.fileId.startsWith('normal')).every((p) => p.prediction === 'Normal'))
  check('Rail reads a plausible speed from the tooth pulse',
    (features[0].speedKmh ?? 0) > 0, `${features[0].speedKmh?.toFixed(1)} km/h`)
  check('Rail rejects a file with the wrong column count', (() => {
    try {
      extractRailFeatures('short.csv', '1,2,3\n4,5,6')
      return false
    } catch {
      return true
    }
  })())

  const csv = buildPredictionCsv('rail', { kind: 'rail', files: predictions })
  check('rail_predictions.csv uses the PS3 header',
    csv.content.split('\n')[0] === 'file_id,prediction')
}

// ----------------------------------------------------------------- SHM -----
{
  // ASTM E1049 Fig. 6 sequence. Published result: range 3 at 0.5 cycles, 4 at
  // 0.5, 4 at 1.0, 8 at 0.5, and residue half cycles of 9, 8 and 6 — 4.0 total.
  const cycles = rainflow(Float64Array.from([-2, 1, -3, 5, -1, 3, -4, 4, -2]))
  const got = cycles.map((c) => `${(c.amplitude * 2).toFixed(0)}@${c.count}`).sort().join(' ')
  const want = ['3@0.5', '4@0.5', '4@1', '8@0.5', '9@0.5', '8@0.5', '6@0.5'].sort().join(' ')
  check('rainflow reproduces the ASTM E1049 worked example', got === want, got)
  check('rainflow conserves the cycle budget',
    cycles.reduce((a, c) => a + c.count, 0) === 4)

  // Miner's rule: double every stress and damage must rise by exactly 2^m.
  const base = damageIndex(cycles, 5)
  const doubled = damageIndex(rainflow(Float64Array.from([-4, 2, -6, 10, -2, 6, -8, 8, -4])), 5)
  check('damage scales as sigma^m', Math.abs(doubled / base - 2 ** 5) < 1e-9, (doubled / base).toFixed(4))

  // Calibration must recover S-N constants it was generated from.
  const TRUE_M = 4
  const TRUE_C = 2.5e6
  const stressSeries = (seed: number) =>
    Array.from({ length: 600 }, (_, i) => Math.sin(i / 3) * (10 + seed * 3) + Math.sin(i / 11) * 20 * seed)
  const features = [1, 2, 3, 4, 5].map((s) =>
    extractShmFeatures(`f${s}.csv`, stressSeries(s).map(String).join('\n')))
  const labels = new Map(features.map((f) => [f.fileId, damageIndex(f.cycles, TRUE_M) / TRUE_C]))
  const fit = calibrate(features, labels)

  check('SHM calibration recovers the S-N exponent', fit !== null && Math.abs(fit.m - TRUE_M) < 0.3,
    fit ? `m = ${fit.m}` : 'no fit')
  check('SHM calibration drives MAPE to ~0 on its own labels', fit !== null && fit.mape < 0.02,
    fit ? `MAPE ${(fit.mape * 100).toFixed(2)}%` : 'no fit')
  check('SHM ignores a monotonic index column', (() => {
    const withIndex = stressSeries(3).map((v, i) => `${i},${v}`).join('\n')
    const a = extractShmFeatures('a.csv', withIndex)
    const b = extractShmFeatures('b.csv', stressSeries(3).map(String).join('\n'))
    return Math.abs(damageIndex(a.cycles, 5) - damageIndex(b.cycles, 5)) < 1e-6
  })())
}

console.log(
  failures === 0
    ? `\nAll checks passed${skipped > 0 ? ` (${skipped} skipped)` : ''}.`
    : `\n${failures} check(s) FAILED.`,
)
process.exit(failures === 0 ? 0 : 1)

/** The Door metric exactly as Door_Subsystem_Info_Kit.md Section 4 defines it. */
function iouWeightedF1(predictions: DoorSegment[], truthRows: string[][]): number {
  const ms = (s: string) => {
    const [y, mo, d, h, mi, sec, msec] = s.split('-').map(Number)
    return Date.UTC(y, mo - 1, d, h, mi, sec, msec)
  }
  const truth = truthRows.map((r) => ({ start: ms(r[1]), end: ms(r[2]), label: r[4], used: false }))
  const preds = predictions.map((p) => ({
    start: ms(p.startTime),
    end: ms(p.endTime),
    label: p.prediction as string,
    used: false,
  }))

  const pairs: { t: number; p: number; iou: number }[] = []
  truth.forEach((t, ti) =>
    preds.forEach((p, pi) => {
      if (t.label !== p.label) return // a different label can never match
      const intersection = Math.max(0, Math.min(t.end, p.end) - Math.max(t.start, p.start))
      const union = t.end - t.start + (p.end - p.start) - intersection
      const iou = union > 0 ? intersection / union : 0
      if (iou > 0) pairs.push({ t: ti, p: pi, iou })
    }),
  )
  pairs.sort((a, b) => b.iou - a.iou) // greedy, highest IoU first

  let matched = 0
  for (const pair of pairs) {
    if (truth[pair.t].used || preds[pair.p].used) continue
    truth[pair.t].used = true
    preds[pair.p].used = true
    matched += pair.iou
  }

  const softRecall = matched / truth.length
  const softPrecision = matched / preds.length
  return softRecall + softPrecision === 0
    ? 0
    : (2 * softRecall * softPrecision) / (softRecall + softPrecision)
}
