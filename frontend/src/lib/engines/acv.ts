import type { AcvCarScore, AcvFileResult } from '../../types'

/**
 * ACV baseline — refrigerant-leak localisation by cross-car temperature deviation.
 *
 * A car losing refrigerant cools less effectively than its neighbours, so under
 * the same ambient conditions and the same control demand its indoor temperature
 * runs hotter than the rest of the train. At every timestamp we take the median
 * indoor temperature across all cars as the "healthy" reference for that moment
 * — which cancels out ambient swings and train-wide control cycling — and score
 * each car on how far above that reference it sits.
 *
 * Column layout is read from each file's own headers ("Car <NN> - <parameter>"),
 * never assumed, because the info kit states the parameter set differs between
 * case files. The car identifier is kept verbatim (e.g. "03"), as the submission
 * schema requires.
 *
 * This is a transparent rule baseline, not a trained model.
 */
export const ACV_BASELINE_LABEL = 'cross-car temperature deviation'

const CAR_HEADER = /^car\s*([0-9]{1,2})\s*[-–—]\s*(.+)$/i

/** Pick the per-car parameter that best represents cabin temperature. */
function chooseTemperatureParam(params: string[]): string | null {
  const lc = params.map((p) => ({ raw: p, k: p.toLowerCase() }))
  const rank = (k: string): number => {
    const isTemp = k.includes('temp')
    if (!isTemp) return -1
    if (k.includes('outdoor') || k.includes('ambient')) return -1
    // A setpoint is a command, not a measurement — it cannot reveal a leak.
    if (k.includes('set') || k.includes('target') || k.includes('control')) return -1
    if (k.includes('indoor') && k.includes('average')) return 100
    if (k.includes('indoor')) return 90
    if (k.includes('saloon') || k.includes('cabin') || k.includes('return')) return 80
    return 40
  }
  let best: { raw: string; score: number } | null = null
  for (const { raw, k } of lc) {
    const s = rank(k)
    if (s > 0 && (best === null || s > best.score)) best = { raw, score: s }
  }
  return best?.raw ?? null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function runAcvBaseline(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<{ result: AcvFileResult; warnings: string[] }> {
  const warnings: string[] = []
  // Loaded on demand: the spreadsheet reader is a third of the bundle and only
  // ACV needs it, so the other three subsystems never pay for it.
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error(`${fileName} contains no sheets.`)
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
  if (rows.length === 0) throw new Error(`${fileName} has no data rows.`)
  if (wb.SheetNames.length > 1) {
    warnings.push(`${fileName}: read the first sheet ("${sheetName}"); ${wb.SheetNames.length - 1} other sheet(s) ignored.`)
  }

  // --- discover cars and their parameters from this file's own headers ---
  const headers = Object.keys(rows[0])
  const byCar = new Map<string, Map<string, string>>() // car -> param -> column
  for (const h of headers) {
    const m = CAR_HEADER.exec(h.trim())
    if (!m) continue
    const car = m[1].trim()
    const param = m[2].trim()
    if (!byCar.has(car)) byCar.set(car, new Map())
    byCar.get(car)!.set(param, h)
  }
  const cars = [...byCar.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
  if (cars.length === 0) {
    throw new Error(
      `${fileName}: no per-car columns found. Expected headers shaped like "Car 03 - ACV Running Mode".`,
    )
  }

  // Choose one temperature parameter, using the parameter set the cars agree on.
  const shared = [...(byCar.get(cars[0])?.keys() ?? [])].filter((p) =>
    cars.every((c) => byCar.get(c)?.has(p)),
  )
  const tempParam = chooseTemperatureParam(shared)
  if (!tempParam) {
    throw new Error(
      `${fileName}: none of the per-car parameters look like a cabin temperature measurement. ` +
        `Parameters seen: ${shared.slice(0, 8).join(', ')}${shared.length > 8 ? '…' : ''}`,
    )
  }
  warnings.push(`${fileName}: ranked on "${tempParam}" across ${cars.length} cars.`)

  // --- per-timestamp deviation from the cross-car median ---
  const sums = new Map<string, number>(cars.map((c) => [c, 0]))
  const counts = new Map<string, number>(cars.map((c) => [c, 0]))
  const series = cars.map((c) => ({ car: c, points: [] as { t: number; value: number }[] }))
  let usableRows = 0

  const TRACE_TARGET = 400
  const traceStep = Math.max(1, Math.floor(rows.length / TRACE_TARGET))

  rows.forEach((row, idx) => {
    const values = cars.map((c) => Number(row[byCar.get(c)!.get(tempParam)!]))
    if (values.some((v) => !Number.isFinite(v))) return
    const ref = median(values)
    usableRows++
    values.forEach((v, i) => {
      const car = cars[i]
      sums.set(car, sums.get(car)! + (v - ref))
      counts.set(car, counts.get(car)! + 1)
      if (idx % traceStep === 0) series[i].points.push({ t: idx, value: v })
    })
  })

  if (usableRows === 0) {
    throw new Error(`${fileName}: "${tempParam}" had no numeric values to compare across cars.`)
  }

  const scored = cars.map((c) => ({ car: c, score: sums.get(c)! / Math.max(1, counts.get(c)!) }))
  scored.sort((a, b) => b.score - a.score)

  const carScores: AcvCarScore[] = scored.map((s, i) => ({
    car: s.car,
    score: s.score,
    rank: i + 1,
    evidence:
      s.score >= 0
        ? `${s.score.toFixed(2)}° above the train median`
        : `${Math.abs(s.score).toFixed(2)}° below the train median`,
  }))

  return {
    result: { fileId: fileName, cars: carScores, series, sampleCount: usableRows },
    warnings,
  }
}
