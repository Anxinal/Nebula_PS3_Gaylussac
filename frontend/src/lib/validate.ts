import type { SubsystemMeta } from '../subsystems'
import type { SubsystemId } from '../types'

/**
 * Upload validation, in two passes.
 *
 * `filterSelection` runs the instant files are chosen and is cheap — extension
 * and emptiness only. `checkHead` runs before the heavy parse and reads just the
 * first slice of each file, so a wrong file is reported in a moment rather than
 * after churning through a whole test folder.
 */

export interface Rejection {
  name: string
  reason: string
}

/** The only file types the app takes at all; each subsystem may narrow this further. */
export const ALLOWED_EXTENSIONS = ['.xlsx', '.csv']

export function filterSelection(
  meta: SubsystemMeta,
  files: File[],
): { accepted: File[]; rejected: Rejection[] } {
  const accepted: File[] = []
  const rejected: Rejection[] = []

  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.startsWith('.') || lower === '__macosx') continue // OS clutter from folder drops
    if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      rejected.push({ name: file.name, reason: 'not an .xlsx or .csv file' })
      continue
    }
    if (!meta.extensions.some((ext) => lower.endsWith(ext))) {
      rejected.push({ name: file.name, reason: `${meta.name} reads ${meta.extensions.join(' or ')} only` })
      continue
    }
    if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'file is empty' })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejected }
}

/** How much of a file is enough to tell whether it is the right kind. */
const HEAD_BYTES = 64 * 1024

export async function checkHead(subsystem: SubsystemId, file: File): Promise<string | null> {
  // A labels file rides along with SHM data to calibrate; it is not stress data.
  if (subsystem === 'shm' && /labels?\.csv$/i.test(file.name)) return null

  const head = await file.slice(0, HEAD_BYTES).text()
  const lines = head.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return `${file.name} has no readable rows.`

  const isCsv = file.name.toLowerCase().endsWith('.csv')

  switch (subsystem) {
    case 'door': {
      const header = lines[0]
      const missing = ['Datetime', 'Motor current(mA)'].filter((c) => !header.includes(c))
      if (missing.length > 0) {
        return (
          `${file.name} does not look like a Door stream — missing ${missing.join(' and ')}. ` +
          `Expected the door controller export whose first column is "Datetime".`
        )
      }
      return null
    }

    case 'rail': {
      const dataLine = lines.find((l) => Number.isFinite(Number(l.split(',')[0])))
      if (!dataLine) return `${file.name} has no numeric rows.`
      const width = dataLine.split(',').length
      if (width !== 129) {
        return (
          `${file.name} has ${width} columns; a Rail recording has 129 ` +
          `(speed pulse + 64 axle boxes x vibration & shock).`
        )
      }
      return null
    }

    case 'shm': {
      const numeric = lines.filter((l) => l.split(',').some((c) => c.trim() !== '' && Number.isFinite(Number(c))))
      if (numeric.length < 4) {
        return `${file.name} has no usable numeric stress column.`
      }
      return null
    }

    case 'acv': {
      // Only CSV can be sniffed as text; .xlsx is binary and is checked on parse.
      if (!isCsv) return null
      if (!/car\s*\d{1,2}\s*[-–—]/i.test(lines[0])) {
        return (
          `${file.name} has no per-car columns. Expected headers shaped like "Car 03 - ACV Running Mode".`
        )
      }
      return null
    }
  }
}
