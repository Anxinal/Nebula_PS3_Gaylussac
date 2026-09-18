import Papa from 'papaparse'

/** Parse a CSV that has a header row into objects. Empty lines are skipped. */
export function parseWithHeader(text: string): Record<string, string>[] {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  return out.data
}

/**
 * Parse a numeric matrix. `hasHeader` is detected rather than assumed: the Rail
 * files ship without a documented header row, but a stray one must not become
 * a row of NaNs.
 */
export function parseNumericMatrix(text: string): { header: string[] | null; rows: number[][] } {
  const out = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' })
  const raw = out.data.filter((r) => r.length > 1)
  if (raw.length === 0) return { header: null, rows: [] }

  const firstIsHeader = raw[0].some((cell) => cell !== '' && !Number.isFinite(Number(cell)))
  const header = firstIsHeader ? raw[0].map((h) => h.trim()) : null
  const body = firstIsHeader ? raw.slice(1) : raw

  const rows = body.map((r) => r.map((cell) => Number(cell)))
  return { header, rows }
}

/** Serialise rows to CSV text. Values containing a comma or quote are quoted. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(esc).join(',')]
  for (const r of rows) lines.push(r.map(esc).join(','))
  return lines.join('\n') + '\n'
}

export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.onload = () => resolve(String(fr.result))
    fr.readAsText(file)
  })
}

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.readAsArrayBuffer(file)
  })
}
