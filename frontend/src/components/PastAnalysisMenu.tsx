import { useEffect, useRef, useState } from 'react'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../subsystems'
import type { RunRecord, SubsystemId } from '../types'

/**
 * A "Past analysis" button in the header that drops down a small table of every
 * subsystem analysed so far — including ones from before a reload, since `runs`
 * comes from storage. Clicking a row opens that result and closes the menu.
 */
export function PastAnalysisMenu({
  runs,
  onSelect,
}: {
  runs: Map<SubsystemId, RunRecord>
  onSelect: (id: SubsystemId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const done = SUBSYSTEM_ORDER.filter((id) => runs.has(id))

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

  if (done.length === 0) return null

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
          className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-hairline shadow-xl"
          style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(14px) saturate(1.2)' }}
        >
          <table className="w-full text-left text-xs">
            <thead className="text-ink-secondary">
              <tr className="border-b border-hairline">
                <th className="px-3 py-2 font-semibold">Subsystem</th>
                <th className="px-3 py-2 font-semibold">Files</th>
                <th className="px-3 py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {done.map((id) => {
                const run = runs.get(id)!
                return (
                  <tr
                    key={id}
                    role="menuitem"
                    tabIndex={0}
                    onClick={() => {
                      onSelect(id)
                      setOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(id)
                        setOpen(false)
                      }
                    }}
                    className="cursor-pointer border-b border-hairline last:border-0 hover:bg-[color-mix(in_srgb,var(--series-1)_8%,transparent)]"
                  >
                    <td className="px-3 py-2 font-medium text-ink">{SUBSYSTEMS[id].name}</td>
                    <td className="tnum px-3 py-2 text-ink-secondary">{run.inputFiles.length}</td>
                    <td className="tnum px-3 py-2 text-ink-muted">
                      {new Date(run.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
