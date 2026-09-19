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
              className="card-clear flex h-full w-full flex-col items-center px-5 pb-6 pt-8 text-center
                         transition-all hover:-translate-y-0.5 hover:shadow-lg"
              // Same 1px hairline as the page's other cards; the picked one turns blue, with a ring
              // drawn outside the border so selecting never shifts the layout.
              style={{
                borderColor: isActive ? 'var(--series-1)' : 'var(--border-hairline)',
                boxShadow: isActive ? '0 0 0 1px var(--series-1)' : undefined,
              }}
            >
              <span
                className="flex h-16 w-16 items-center justify-center rounded-2xl text-[2.1rem]"
                style={{
                  color: isActive ? 'var(--series-1)' : 'var(--text-secondary)',
                  background: isActive
                    ? 'color-mix(in srgb, var(--series-1) 14%, transparent)'
                    : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                }}
              >
                <Icon />
              </span>

              <span className="display mt-4 text-2xl font-bold tracking-tight text-ink">{meta.name}</span>
              <span className="mt-1.5 text-base leading-snug text-ink-secondary">{meta.tagline}</span>

              {isDone && (
                <span
                  className="mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium"
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
