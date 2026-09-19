import { ColumnChart } from '../charts/ColumnChart'
import { SectionHead, StatTile } from '../StatTile'
import { fmt } from '../charts/chartUtils'
import type { RailLabel, RailResult } from '../../types'

const CLASS_COLOR: Record<RailLabel, string> = {
  Normal: 'var(--series-1)',
  'Side I': 'var(--series-2)',
  'Side II': 'var(--series-3)',
}

const CLASS_MARK: Record<RailLabel, string> = {
  Normal: '●',
  'Side I': '◆',
  'Side II': '■',
}

export function RailResults({ result }: { result: RailResult }) {
  const counts: Record<RailLabel, number> = { Normal: 0, 'Side I': 0, 'Side II': 0 }
  for (const f of result.files) counts[f.prediction]++
  const faults = counts['Side I'] + counts['Side II']
  const speeds = result.files.map((f) => f.speedKmh).filter((s): s is number => s !== null)
  const meanSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Recordings"
          value={result.files.length}
          hint="Each file is one second of axle-box vibration and shock, sampled at 10 kHz across 64 axle boxes."
        />
        <StatTile
          label="Flagged"
          value={faults}
          tone={faults > 0 ? 'critical' : 'good'}
          sub={`${counts['Side I']} Side I · ${counts['Side II']} Side II`}
          hint="Recordings where one rail carries markedly more vibration energy than the other — the signature of corrugation. Side I is axle-box positions 1, 3, 5, 7; Side II is 2, 4, 6, 8."
        />
        <StatTile
          label="Normal"
          value={counts.Normal}
          tone="good"
          hint="Both rails in balance — neither side stands out from the batch."
        />
        <StatTile
          label="Mean speed"
          value={meanSpeed !== null ? `${meanSpeed.toFixed(0)} km/h` : '—'}
          sub="from the wheel pulse"
          hint="Derived by counting 0/1 transitions of the 90-tooth speed sensor over the recording, on a 0.85 m wheel. Speed matters because vibration amplitude rises with it."
        />
      </div>

      <section className="card p-4">
        <SectionHead
          title="Class split"
          hint="How the batch divided across the three classes. Each class carries its own marker and label, so the split is readable without relying on colour."
        />
        <div className="flex flex-wrap gap-3">
          {(Object.keys(counts) as RailLabel[]).map((label) => {
            const share = result.files.length > 0 ? counts[label] / result.files.length : 0
            return (
              <div key={label} className="min-w-[10rem] flex-1 rounded-lg border border-hairline px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <span aria-hidden style={{ color: CLASS_COLOR[label] }}>{CLASS_MARK[label]}</span>
                  {label}
                </div>
                <div className="tnum mt-1 text-xl font-semibold text-ink">{counts[label]}</div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--page-plane)' }}>
                  <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: CLASS_COLOR[label] }} />
                </div>
                <div className="tnum mt-1 text-[11px] text-ink-muted">{(share * 100).toFixed(0)}% of files</div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card p-4">
        <SectionHead
          title="Side imbalance"
          hint="Side I vibration energy minus Side II, per recording. Comparing the two sides within the same file cancels out speed and track roughness, since both sides share them. Files far from zero have one rail much louder than the other — that is what corrugation looks like from the axle boxes."
        />
        <ColumnChart
          data={[...result.files]
            .sort((a, b) => b.sideI - b.sideII - (a.sideI - a.sideII))
            .map((f) => ({
              label: f.fileId,
              value: f.sideI - f.sideII,
              color: CLASS_COLOR[f.prediction],
              detail: `${f.prediction} · Side I ${fmt(f.sideI, 3)} vs Side II ${fmt(f.sideII, 3)}`,
            }))}
          valueLabel="Side I − Side II (m/s²)"
          categoryLabel="Recording"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-hairline px-4 py-3">
          <SectionHead
            title="Per-file result"
            hint="Exactly the rows written to rail_predictions.csv, plus the side energies and speed behind each call."
          />
        </div>
        <div className="max-h-[26rem] overflow-auto">
          <table className="w-full text-left text-[0.72rem]">
            <thead className="sticky top-0 bg-surface text-ink-secondary">
              <tr className="border-b border-hairline">
                <th className="whitespace-nowrap px-3 py-2 font-semibold">file_id</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">prediction</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Side I RMS</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Side II RMS</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Speed</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {result.files.map((f) => (
                <tr key={f.fileId} className="border-b border-hairline last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{f.fileId}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <span aria-hidden style={{ color: CLASS_COLOR[f.prediction] }}>{CLASS_MARK[f.prediction]}</span>
                      {f.prediction}
                    </span>
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{fmt(f.sideI, 4)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{fmt(f.sideII, 4)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">
                    {f.speedKmh !== null ? `${f.speedKmh.toFixed(0)} km/h` : '—'}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{(f.confidence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
