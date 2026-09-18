import { useState } from 'react'
import { HBarChart } from '../charts/HBarChart'
import { SectionHead, StatTile } from '../StatTile'
import { fmt } from '../charts/chartUtils'
import type { ShmResult } from '../../types'

export function ShmResults({ result, calibrated }: { result: ShmResult; calibrated: boolean }) {
  const [selected, setSelected] = useState(0)
  const values = result.files.map((f) => f.prediction)
  const worst = result.files.reduce((a, b) => (b.prediction > a.prediction ? b : a), result.files[0])
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
  const file = result.files[Math.min(selected, result.files.length - 1)]

  return (
    <div className="space-y-6">
      {!calibrated && (
        <p
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'color-mix(in srgb, var(--status-warning) 10%, var(--surface-1))',
          }}
        >
          <strong>▲ Uncalibrated.</strong> These are relative damage indices from default S-N constants,
          not damage in the units PS3 scores. Drop the Train folder together with{' '}
          <code>Train_Labels.csv</code> once to fit the curve, then re-run your test files.
        </p>
      )}

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
          hint="Estimated cumulative fatigue damage for each segment, computed by rainflow counting the stress history and summing each cycle's contribution through the S-N curve. Fatigue failure is reached at D = 1."
        />
        <HBarChart
          data={[...result.files]
            .sort((a, b) => b.prediction - a.prediction)
            .map((f) => ({
              label: f.fileId,
              value: f.prediction,
              detail: `${Math.round(f.cycles).toLocaleString()} cycles · max range ${fmt(f.maxRange, 3)}`,
            }))}
          valueLabel="Cumulative damage D"
        />
      </section>

      {file && file.bins.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <SectionHead
              title="Damage by stress range"
              hint="Rows are stress-range bands, labelled by the middle of the band; bar length is the damage that band contributed. Because damage scales with stress to the power m, a handful of large ranges usually dominate the total even though small ones are far more numerous."
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
          <HBarChart
            data={file.bins.map((b) => ({
              label: fmt(b.rangeMid, 3),
              value: b.damage,
              detail: `${Math.round(b.cycles).toLocaleString()} cycles in this band`,
            }))}
            valueLabel="Damage contribution"
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
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right font-medium text-ink">{fmt(f.prediction, 6)}</td>
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
