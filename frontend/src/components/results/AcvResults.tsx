import { ColumnChart } from '../charts/ColumnChart'
import { TrainDiagram } from '../charts/TrainDiagram'
import { SectionHead, StatTile } from '../StatTile'
import { fmt } from '../charts/chartUtils'
import type { AcvResult } from '../../types'

export function AcvResults({ result }: { result: AcvResult }) {
  return (
    <div className="space-y-8">
      {result.files.map((file) => {
        const top = file.cars[0]
        const runnerUp = file.cars[1]
        const margin = top && runnerUp ? top.score - runnerUp.score : 0
        return (
          <div key={file.fileId} className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Case file"
                value={<span className="text-base">{file.fileId}</span>}
                sub={`${file.cars.length} cars ranked`}
                hint="One telemetry file covering every car on the train, sampled every 30 seconds. Exactly one car in it has a refrigerant leak."
              />
              <StatTile
                label="Check first"
                value={top ? `Car ${top.car}` : '—'}
                tone="critical"
                sub={top?.evidence}
                hint="The car the model ranks most likely to be losing refrigerant. Scoring gives partial credit for near misses, so the full ranking below matters too, not just this top pick."
              />
              <StatTile
                label="Lead over 2nd"
                value={`${fmt(margin, 3)}°`}
                sub={runnerUp ? `2nd: Car ${runnerUp.car}` : undefined}
                hint="How much hotter the top-ranked car runs than the runner-up. A small lead means the two are hard to separate — worth checking both."
              />
              <StatTile
                label="Samples"
                value={file.sampleCount.toLocaleString()}
                sub="timestamps compared"
                hint="Timestamps where every car reported a usable temperature, so all cars could be compared against each other at the same moment."
              />
            </div>

            <section className="card p-4">
              <SectionHead
                title="Where to look first"
                hint="The train drawn in physical car order, with the ranking laid over it — so a maintainer reads which car to walk to without decoding a chart."
              />
              <TrainDiagram cars={file.cars} />
            </section>

            <section className="card p-4">
              <SectionHead
                title="Temperature vs the train"
                hint="At each timestamp the median cabin temperature across all cars is taken as the healthy reference — which cancels out ambient swings and train-wide control cycling. Bars right of zero run hotter than that reference; a leaking car cools less than its neighbours and sits above the rest."
              />
              <ColumnChart
                data={file.cars.map((c) => ({
                  label: `Car ${c.car}`,
                  value: c.score,
                  detail: `Rank ${c.rank} of ${file.cars.length}`,
                }))}
                valueLabel="Deviation (°)"
                categoryLabel="Car, most likely leak first"
                highlightIndex={0}
              />
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-hairline px-4 py-3">
                <SectionHead
                  title="Ranking"
                  hint="Every car ordered from most to least likely faulty. This exact order, pipe-separated, is what goes into acv_predictions.csv."
                  right={<code className="tnum text-xs text-ink-muted">{file.cars.map((c) => c.car).join('|')}</code>}
                />
              </div>
              <table className="w-full text-left text-[0.72rem]">
                <thead className="text-ink-secondary">
                  <tr className="border-b border-hairline">
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">Rank</th>
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">Car</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Deviation (°)</th>
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {file.cars.map((c) => (
                    <tr key={c.car} className="border-b border-hairline last:border-0">
                      <td className="tnum whitespace-nowrap px-3 py-2 text-ink-muted">{c.rank}</td>
                      <td className="tnum whitespace-nowrap px-3 py-2 font-medium text-ink">{c.car}</td>
                      <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{fmt(c.score, 4)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{c.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )
      })}
    </div>
  )
}
