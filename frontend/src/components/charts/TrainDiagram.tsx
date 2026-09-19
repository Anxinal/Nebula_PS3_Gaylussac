import type { AcvCarScore } from '../../types'

/**
 * The train, drawn as its cars in physical order, with the ranking laid over it.
 * A maintainer reads "which car do I go to" off this without decoding a chart.
 */
export function TrainDiagram({ cars }: { cars: AcvCarScore[] }) {
  const ordered = [...cars].sort((a, b) => Number(a.car) - Number(b.car) || a.car.localeCompare(b.car))
  const top = cars.find((c) => c.rank === 1)
  const second = cars.find((c) => c.rank === 2)

  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {ordered.map((c) => {
          const isTop = c.rank === 1
          const isSecond = c.rank === 2
          return (
            <div
              key={c.car}
              className="min-w-[72px] flex-1 rounded-lg border px-2 py-3 text-center"
              style={{
                borderColor: isTop ? 'var(--status-critical)' : 'var(--border-hairline)',
                borderWidth: isTop ? 2 : 1,
                background: isTop
                  ? 'color-mix(in srgb, var(--status-critical) 12%, var(--surface-1))'
                  : isSecond
                    ? 'color-mix(in srgb, var(--status-warning) 12%, var(--surface-1))'
                    : 'var(--surface-1)',
              }}
            >
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">Car</div>
              <div className="tnum text-lg font-semibold text-ink">{c.car}</div>
              <div className="tnum mt-1 text-[11px] text-ink-secondary">#{c.rank}</div>
              {isTop && (
                <div className="mt-1 text-[11px] font-medium" style={{ color: 'var(--status-critical)' }}>
                  ▲ check first
                </div>
              )}
            </div>
          )
        })}
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-ink-secondary">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: 'var(--status-critical)' }} />
          Most likely leaking
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: 'var(--status-warning)' }} />
          Runner-up
        </li>
      </ul>
      {top && (
        <p className="mt-3 text-center text-sm text-ink-secondary">
          Most likely leaking: <strong className="text-ink">Car {top.car}</strong> ({top.evidence}).
          {second && <> Next: Car {second.car} ({second.evidence}).</>}
        </p>
      )}
    </div>
  )
}
