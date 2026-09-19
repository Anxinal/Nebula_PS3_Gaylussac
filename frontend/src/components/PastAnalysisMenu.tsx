import { useEffect, useRef, useState } from 'react'
import { SUBSYSTEMS } from '../subsystems'
import type { RunRecord } from '../types'

/** "Test.csv, Test2.csv" — or, once there are too many to read at a glance, the first few plus a count, with the rest on hover. */
function summariseFiles(names: string[], max = 3): { text: string; title?: string } {
  if (names.length <= max) return { text: names.join(', ') }
  return { text: `${names.slice(0, max).join(', ')}, +${names.length - max} more`, title: names.join(', ') }
}

/**
 * A "Past analysis" button in the header that drops down a small table of every
 * analysis run so far — including ones from before a reload, since `runs` comes
 * from storage. Running the same subsystem more than once (e.g. Door Fault with
 * 3 files, then again with 5) adds a separate row each time rather than
 * replacing the last one, so every past run stays reachable. Clicking a row
 * opens that run and closes the menu.
 */
export function PastAnalysisMenu({
  runs,
  onSelect,
}: {
  runs: RunRecord[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Most recent first.
  const rows = [...runs].sort((a, b) => b.finishedAt - a.finishedAt)

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (rows.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn-ghost !px-2.5 !py-1.5 text-xs font-semibold"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        Past analysis
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-[26rem] max-w-[90vw] overflow-hidden rounded-xl border border-hairline shadow-xl"
          style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(14px) saturate(1.2)' }}
        >
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-ink-secondary">
                <tr className="border-b border-hairline">
                  <th className="px-3 py-2 font-semibold">Subsystem</th>
                  <th className="px-3 py-2 font-semibold">Files</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => (
                  <tr
                    key={run.id}
                    role="menuitem"
                    tabIndex={0}
                    onClick={() => {
                      onSelect(run.id)
                      setOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(run.id)
                        setOpen(false)
                      }
                    }}
                    className="cursor-pointer border-b border-hairline last:border-0 hover:bg-[color-mix(in_srgb,var(--series-1)_8%,transparent)]"
                  >
                    <td className="px-3 py-2 font-medium text-ink">{SUBSYSTEMS[run.subsystem].name}</td>
                    <td className="px-3 py-2 text-ink-secondary" title={summariseFiles(run.inputFiles).title}>
                      {summariseFiles(run.inputFiles).text}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-ink-muted">
                      {new Date(run.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
