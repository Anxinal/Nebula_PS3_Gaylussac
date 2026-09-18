/**
 * The Door dataset stores time as Year-Month-Date-Hour-Minute-Second-Millisecond,
 * hyphen-separated and NOT zero-padded, e.g. "2023-7-5-0-11-17-664".
 * PS3 accepts either that native format or an ISO timestamp in the submission,
 * so we read both and always write back the native one the dataset uses.
 */
export function parseDoorTime(raw: string): number {
  const s = raw.trim()
  const parts = s.split('-')
  if (parts.length === 7) {
    const [y, mo, d, h, mi, sec, ms] = parts.map((p) => Number(p))
    if ([y, mo, d, h, mi, sec, ms].every((n) => Number.isFinite(n))) {
      return Date.UTC(y, mo - 1, d, h, mi, sec, ms)
    }
  }
  const iso = Date.parse(s)
  if (Number.isFinite(iso)) return iso
  return NaN
}

export function formatDoorTime(ms: number): string {
  const d = new Date(ms)
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  ].join('-')
}

/** "1h 04m 12s" — used for stream duration readouts. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(Math.floor(s)).padStart(2, '0')}s`
  if (m > 0) return `${m}m ${String(Math.floor(s)).padStart(2, '0')}s`
  return `${s.toFixed(1)}s`
}
