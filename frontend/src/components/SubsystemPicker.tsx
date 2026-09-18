import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../subsystems'
import { SUBSYSTEM_ICON } from './icons'
import { InfoHint } from './InfoHint'
import type { SubsystemId } from '../types'

export function SubsystemPicker({
  active,
  completed,
  onSelect,
}: {
  active: SubsystemId | null
  completed: Set<SubsystemId>
  onSelect: (id: SubsystemId) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {SUBSYSTEM_ORDER.map((id) => {
        const meta = SUBSYSTEMS[id]
        const Icon = SUBSYSTEM_ICON[id]
        const isActive = active === id
        const isDone = completed.has(id)
        return (
          <div key={id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={isActive}
              className="card flex h-full w-full flex-col items-center px-4 pb-4 pt-6 text-center
                         transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{
                borderColor: isActive ? 'var(--series-1)' : 'var(--border-hairline)',
                borderWidth: isActive ? 2 : 1,
              }}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl text-[1.6rem]"
                style={{
                  color: isActive ? 'var(--series-1)' : 'var(--text-secondary)',
                  background: isActive
                    ? 'color-mix(in srgb, var(--series-1) 14%, transparent)'
                    : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                }}
              >
                <Icon />
              </span>

              <span className="display mt-3 text-lg font-bold tracking-tight text-ink">{meta.name}</span>
              <span className="mt-1 text-sm leading-snug text-ink-secondary">{meta.tagline}</span>

              {isDone && (
                <span
                  className="mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    color: 'var(--status-good)',
                    background: 'color-mix(in srgb, var(--status-good) 14%, transparent)',
                  }}
                >
                  <span aria-hidden>✓</span> ready
                </span>
              )}
            </button>

            {/* Outside the button: a control inside a button is not valid markup. */}
            <span className="absolute right-2.5 top-2.5">
              <InfoHint label={`About ${meta.name}`}>
                <strong className="text-ink">{meta.name}</strong>
                <br />
                {meta.detail}
                <br />
                <span className="mt-1.5 block text-ink-muted">Reads: {meta.signal}</span>
              </InfoHint>
            </span>
          </div>
        )
      })}
    </div>
  )
}
