import { toCsv } from './csv'
import { SUBSYSTEMS } from '../subsystems'
import type { SubsystemId, SubsystemResult } from '../types'

/**
 * Build the submission CSV for a subsystem, in the exact schema PS3 specifies
 * (Section 4.1). Door has no file_id column and one row per predicted segment;
 * ACV has ranked_cars instead of prediction, pipe-separated, with the car
 * identifier verbatim from the file's own headers.
 */
export function buildPredictionCsv(
  subsystem: SubsystemId,
  result: SubsystemResult,
): { filename: string; content: string } {
  const filename = SUBSYSTEMS[subsystem].outputFile

  switch (result.kind) {
    case 'door':
      return {
        filename,
        content: toCsv(
          ['start_time', 'end_time', 'prediction'],
          result.segments.map((s) => [s.startTime, s.endTime, s.prediction]),
        ),
      }
    case 'acv':
      return {
        filename,
        content: toCsv(
          ['file_id', 'ranked_cars'],
          result.files.map((f) => [f.fileId, f.cars.map((c) => c.car).join('|')]),
        ),
      }
    case 'rail':
      return {
        filename,
        content: toCsv(
          ['file_id', 'prediction'],
          result.files.map((f) => [f.fileId, f.prediction]),
        ),
      }
    case 'shm':
      return {
        filename,
        content: toCsv(
          ['file_id', 'prediction'],
          // Six significant figures: enough that rounding cannot move MAPE,
          // without writing float noise into the submission.
          result.files.map((f) => [f.fileId, Number(f.prediction.toPrecision(6))]),
        ),
      }
  }
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  downloadBlob(filename, blob)
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
