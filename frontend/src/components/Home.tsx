import { useEffect, useRef, useState } from 'react'
import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../subsystems'
import { SUBSYSTEM_ICON } from './icons'
import type { SubsystemId } from '../types'

/**
 * Landing page. Its one job is to say what this does and get you into the
 * console, through the subsystem you have data for.
 *
 * On wide screens it splits in two: the headline sits over the train scene on
 * the left three fifths (the backdrop narrows itself to match) and everything
 * you act on sits in a solid panel on the right. On narrow screens it all
 * stacks over the scene. Picking a subsystem slides the panel out to the
 * right before the console opens.
 */

const LEAVE_MS = 280 // matches .panel-out in index.css
export function Home({ onStart }: { onStart: (subsystem?: SubsystemId) => void }) {
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pick = (id: SubsystemId) => {
    if (leaving) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onStart(id)
    setLeaving(true)
    timer.current = window.setTimeout(() => onStart(id), LEAVE_MS)
  }
  const out = leaving ? 'panel-out pointer-events-none' : ''

  return (
    <main className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[3fr_2fr]">
      {/* Panel background, pinned to the right two fifths so it runs the full height behind the header too */}
      <div
        aria-hidden
        className={`fixed inset-y-0 right-0 -z-[5] hidden w-2/5 border-l border-hairline lg:block ${out}`}
        style={{
          // A soft blue wash from the top corner and the foot of the panel, built on theme tokens so it holds in dark mode
          background: `radial-gradient(120% 60% at 100% 0%, color-mix(in srgb, var(--series-1) 22%, transparent), transparent 70%),
            linear-gradient(180deg, var(--surface-1) 35%, color-mix(in srgb, var(--series-1) 18%, var(--surface-1)) 100%)`,
        }}
      />

      {/* Left: the headline, over the sky above the train */}
      <div className="px-4 pt-10 sm:pt-14 lg:px-10 lg:pt-[6vh]">
        <h1 className="display headline-glow text-center text-3xl uppercase leading-[1.05] text-ink sm:text-4xl xl:text-5xl">
          <span className="display-outline block">Find the fault before</span>
          <span className="block font-black">the fault finds you</span>
        </h1>
      </div>

      <div
        className={`mx-auto flex w-full max-w-xl flex-col px-4 pb-12 pt-8 lg:h-full lg:overflow-hidden lg:px-8 lg:py-4 ${out}`}
      >
        {/* A small fixed gap above, flexible space below: sits higher than dead centre, still with no scroll */}
        <div className="mt-[6vh] mb-auto lg:mt-[5vh]">
          <section>
            <h2 className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted lg:text-left">
              Pick where to start
            </h2>

            <div className="mt-3.5 grid gap-3">
              {SUBSYSTEM_ORDER.map((id) => {
                const meta = SUBSYSTEMS[id]
                const Icon = SUBSYSTEM_ICON[id]
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pick(id)}
                    className="card pick-card group flex items-center gap-3.5 px-4 py-3 text-left transition-all
                               hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[1.15rem]"
                      style={{
                        color: 'var(--series-1)',
                        background: 'color-mix(in srgb, color-mix(in srgb, var(--series-1) 72%, var(--series-3)) 16%, transparent)',
                        // A thin tinted edge and a soft glow around the tile
                        boxShadow: `0 0 0 1px color-mix(in srgb, color-mix(in srgb, var(--series-1) 72%, var(--series-3)) 30%, transparent), 0 0 14px color-mix(in srgb, color-mix(in srgb, var(--series-1) 72%, var(--series-3)) 35%, transparent)`,
                      }}
                    >
                      <Icon />
                    </span>
                    <span className="min-w-0">
                      <span className="display block text-sm font-bold leading-tight text-ink">
                        {meta.name}
                        <span
                          aria-hidden
                          className="ml-1.5 inline-block transition-transform group-hover:translate-x-1"
                          style={{ color: 'var(--series-1)' }}
                        >
                          →
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">{meta.tagline}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted lg:text-left">
              How it works
            </h2>
            <ol className="mt-3 space-y-2.5">
              {[
                ['Choose', 'Pick the subsystem you have data for'],
                ['Drop', 'Drag in a file, or a whole folder at once'],
                ['Read & download', 'See what it found, then take the CSV'],
              ].map(([title, body], i) => (
                <li key={title} className="flex items-center gap-3.5">
                  <span
                    className="display flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold"
                    style={{
                      color: 'var(--series-1)',
                      background: 'color-mix(in srgb, var(--series-1) 14%, transparent)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs leading-snug text-ink-secondary">
                    <strong className="text-ink">{title}</strong> — {body}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  )
}
