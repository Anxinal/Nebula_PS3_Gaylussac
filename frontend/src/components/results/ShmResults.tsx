import { useState } from 'react'
import { ColumnChart } from '../charts/ColumnChart'
import { SectionHead, StatTile } from '../StatTile'
import { fmt } from '../charts/chartUtils'
import type { ShmResult } from '../../types'

/*
 * Colour coding. Every number here comes from the model backend's /predict/shm reply;
 * this file only colours it. Damage D is placed on a log scale from 0.01 to 1 (Miner's
 * failure threshold), because real values span two orders of magnitude, and mapped to
 * a hue that runs green → yellow → orange → red. D ≥ 1 gets a deeper red of its own.
 */
const D_FLOOR = 0.01
const damagePosition = (d: number) =>
  Math.min(1, Math.max(0, Math.log10(Math.max(d, D_FLOOR) / D_FLOOR) / Math.log10(1 / D_FLOOR)))
const ramp = (t: number) => `oklch(${0.74 - 0.12 * t} ${0.13 + 0.07 * t} ${155 - 130 * t})`
export const damageColor = (d: number) => (d >= 1 ? 'oklch(0.55 0.2 20)' : ramp(damagePosition(d)))

/** The key under the damage chart: the hue scale with its log ticks. */
function DamageScale() {
  const stops = Array.from({ length: 9 }, (_, i) => `${ramp(i / 8)} ${(i / 8) * 100}%`).join(', ')
  return (
    <div className="mt-3">
      <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <div className="mt-1 flex justify-between text-[0.68rem] text-ink-muted tnum">
        <span>≤ 0.01</span>
        <span>0.1</span>
        <span>1 · failure</span>
      </div>
    </div>
  )
}

export function ShmResults({ result }: { result: ShmResult }) {
  const [selected, setSelected] = useState(0)
  const values = result.files.map((f) => f.prediction)
  const worst = result.files.reduce((a, b) => (b.prediction > a.prediction ? b : a), result.files[0])
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
  const file = result.files[Math.min(selected, result.files.length - 1)]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Files"
          value={result.files.length}
          hint="Each file is one equal-length segment of dynamic stress recorded at a measurement point on the vehicle structure."
        />
        <StatTile
          label="Highest"
          value={fmt(worst?.prediction ?? 0, 4)}
          sub={worst?.fileId}
          tone={(worst?.prediction ?? 0) >= 1 ? 'critical' : (worst?.prediction ?? 0) >= 0.5 ? 'warning' : 'good'}
          hint="The most fatigue-damaged segment in this batch. Under Miner's rule damage accumulates linearly and failure is reached at D = 1, so this is the share of the fatigue budget that segment consumed."
        />
        <StatTile
          label="Mean"
          value={fmt(mean, 4)}
          sub="across this batch"
          hint="Average cumulative damage across the batch — a rough sense of how hard this stretch of line works the structure."
        />
        <StatTile
          label="At or past D = 1"
          value={values.filter((v) => v >= 1).length}
          sub="Miner's threshold"
          tone={values.some((v) => v >= 1) ? 'critical' : 'good'}
          hint="Segments whose estimated damage has reached or passed D = 1, the point at which Miner's linear rule predicts fatigue failure."
        />
      </div>

      <section className="card p-4">
        <SectionHead
          title="Damage per file"
          hint="Estimated cumulative fatigue damage for each segment, from the trained model: rainflow counting of the stress history, a Miner's-rule anchor and a forest on the residual. Fatigue failure is reached at D = 1. Colour follows the scale below, on a log axis so small and large values both separate."
        />
        <ColumnChart
          data={[...result.files]
            .sort((a, b) => b.prediction - a.prediction)
            .map((f) => ({
              label: f.fileId,
              value: f.prediction,
              color: damageColor(f.prediction),
              detail: `${Math.round(f.cycles).toLocaleString()} cycles · max range ${fmt(f.maxRange, 3)}`,
            }))}
          valueLabel="Cumulative damage D"
          categoryLabel="Segment file, most damaged first"
        />
        <DamageScale />
      </section>

      {file && file.bins.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <SectionHead
              title="Damage by stress range"
              hint="Each column is a stress-range band, labelled by the middle of the band; its height is the share of the file's damage that band contributed, and its colour runs green to red from the smallest share to the largest. Because damage scales with stress to the power m, a handful of large ranges usually dominate the total even though small ones are far more numerous."
            />
            <label className="text-xs text-ink-secondary">
              File{' '}
              <select
                className="ml-1 rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink"
                value={Math.min(selected, result.files.length - 1)}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {result.files.map((f, i) => (
                  <option key={f.fileId} value={i}>
                    {f.fileId}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ColumnChart
            data={(() => {
              // Hue by each band's share relative to the file's heaviest band: cool for minor bands, hot for the dominant ones.
              const top = Math.max(...file.bins.map((b) => b.damage), 1e-12)
              return file.bins.map((b) => ({
                label: fmt(b.rangeMid, 3),
                value: b.damage,
                color: ramp(b.damage / top),
                detail: `${Math.round(b.cycles).toLocaleString()} cycles in this band`,
              }))
            })()}
            valueLabel="Share of damage"
            categoryLabel="Stress range (band midpoint)"
          />
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-hairline px-4 py-3">
          <SectionHead
            title="Per-file result"
            hint="Exactly the rows written to shm_predictions.csv, plus the rainflow cycle count and largest stress range behind each estimate."
          />
        </div>
        <div className="max-h-[26rem] overflow-auto">
          <table className="w-full text-left text-[0.72rem]">
            <thead className="sticky top-0 bg-surface text-ink-secondary">
              <tr className="border-b border-hairline">
                <th className="whitespace-nowrap px-3 py-2 font-semibold">file_id</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">prediction</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Rainflow cycles</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Max stress range</th>
              </tr>
            </thead>
            <tbody>
              {result.files.map((f) => (
                <tr key={f.fileId} className="border-b border-hairline last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{f.fileId}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right font-medium text-ink">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: damageColor(f.prediction) }} />
                      {fmt(f.prediction, 6)}
                    </span>
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{Math.round(f.cycles).toLocaleString()}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">{fmt(f.maxRange, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
