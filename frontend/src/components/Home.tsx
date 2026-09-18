import { SUBSYSTEMS, SUBSYSTEM_ORDER } from '../subsystems'
import { SUBSYSTEM_ICON } from './icons'
import { InfoHint } from './InfoHint'
import type { SubsystemId } from '../types'

/**
 * Landing page. Its one job is to say what this does and get you into the
 * console — either straight in, or into a specific subsystem.
 */
export function Home({ onStart }: { onStart: (subsystem?: SubsystemId) => void }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-14 sm:pt-20">
      <section className="text-center">
        <p className="eyebrow">NebulaX 2026 · Problem Statement 3</p>

        <h1 className="display mx-auto mt-4 max-w-3xl text-4xl font-bold leading-[1.08] text-ink sm:text-6xl">
          Find the fault before
          <br />
          the train finds you
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-secondary">
          Drop in raw sensor data from a train and get a <strong>clear answer back</strong> — which door is
          binding, which car is losing refrigerant, which rail is corrugated, how much fatigue a structure has
          taken. <strong>No code, no setup.</strong>
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className="btn-primary !px-7 !py-3 !text-base !font-semibold"
            onClick={() => onStart()}
          >
            Try it out
            <span aria-hidden className="text-lg leading-none">
              →
            </span>
          </button>
          <a
            href="https://github.com/Anxinal/Nebula_PS3_Gaylussac"
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost !px-5 !py-3 !text-base"
          >
            View the code
          </a>
        </div>

        <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap items-stretch justify-center gap-3">
          {[
            {
              value: '4',
              label: 'subsystems',
              hint: 'Door, ACV, Rail Corrugation and SHM — the four independent rail-vehicle subsystems PS3 covers. Each is scored separately, and attempting more can only raise your overall score.',
            },
            {
              value: '1.000',
              label: 'Door F1 on training data',
              hint: "The Door baseline recovers all 110 labelled cycles in Train.csv with exactly matching boundaries and labels — an IoU-weighted F1 of 1.000 under the metric PS3 scores Door on. That is the training set, not the held-out test set.",
            },
            {
              value: '0',
              label: 'files leave your device',
              hint: 'Parsing, feature extraction and prediction all run in this browser tab. Files are only sent anywhere if you deliberately connect a model backend from the header.',
            },
          ].map((stat) => (
            <li key={stat.label} className="card min-w-[13rem] flex-1 px-5 py-4 text-center">
              <div className="display text-3xl font-bold text-ink">{stat.value}</div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-secondary">
                {stat.label}
                <InfoHint label={`About ${stat.label}`}>{stat.hint}</InfoHint>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Pick where to start
        </h2>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SUBSYSTEM_ORDER.map((id) => {
            const meta = SUBSYSTEMS[id]
            const Icon = SUBSYSTEM_ICON[id]
            return (
              <button
                key={id}
                type="button"
                onClick={() => onStart(id)}
                className="card group flex flex-col items-center px-4 pb-5 pt-6 text-center transition-all
                           hover:-translate-y-1 hover:shadow-xl"
              >
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-2xl text-[1.75rem] transition-colors"
                  style={{
                    color: 'var(--series-1)',
                    background: 'color-mix(in srgb, var(--series-1) 12%, transparent)',
                  }}
                >
                  <Icon />
                </span>
                <span className="display mt-3.5 text-lg font-bold text-ink">{meta.name}</span>
                <span className="mt-1.5 text-sm leading-snug text-ink-secondary">{meta.tagline}</span>
                <span className="mt-3 text-sm font-semibold" style={{ color: 'var(--series-1)' }}>
                  Open
                  <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">
          How it works
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['Choose', 'Pick the subsystem you have data for.'],
            ['Drop', 'Drag in a file, or a whole folder at once.'],
            ['Read & download', 'See what it found, then take the CSV.'],
          ].map(([title, body], i) => (
            <li key={title} className="card flex gap-3.5 px-5 py-4">
              <span
                className="display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{
                  color: 'var(--series-1)',
                  background: 'color-mix(in srgb, var(--series-1) 14%, transparent)',
                }}
              >
                {i + 1}
              </span>
              <span>
                <strong className="block text-base text-ink">{title}</strong>
                <span className="mt-0.5 block text-sm leading-snug text-ink-secondary">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
