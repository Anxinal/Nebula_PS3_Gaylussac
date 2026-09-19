import type { RunRecord, SubsystemId } from '../types'

/**
 * Keeps completed analyses across a page reload. A `RunRecord` is plain data
 * (no functions, no `File` objects — see types.ts), so it round-trips through
 * JSON exactly; nothing here re-derives or guesses a value.
 */

const KEY = 'nebula-runs'

export function loadRuns(): Map<SubsystemId, RunRecord> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Partial<Record<SubsystemId, RunRecord>>
    return new Map(Object.entries(obj) as [SubsystemId, RunRecord][])
  } catch {
    // Corrupted, blocked, or from an older shape — start empty rather than crash.
    return new Map()
  }
}

export function saveRuns(runs: Map<SubsystemId, RunRecord>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(runs)))
  } catch {
    // Storage full or blocked (private mode) — the runs still work for this tab.
  }
}
