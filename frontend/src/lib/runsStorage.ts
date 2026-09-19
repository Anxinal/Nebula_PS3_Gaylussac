import type { RunRecord } from '../types'

/**
 * Keeps every completed analysis across a page reload — including more than one
 * run of the same subsystem (e.g. Door Fault tried with 3 files, then again with
 * 5), since each `RunRecord` carries its own id and nothing here overwrites an
 * earlier entry. A `RunRecord` is plain data (no functions, no `File` objects —
 * see types.ts), so it round-trips through JSON exactly.
 */

const KEY = 'nebula-runs'

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : []
  } catch {
    // Corrupted, blocked, or from an older shape — start empty rather than crash.
    return []
  }
}

export function saveRuns(runs: RunRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs))
  } catch {
    // Storage full or blocked (private mode) — the runs still work for this tab.
  }
}
