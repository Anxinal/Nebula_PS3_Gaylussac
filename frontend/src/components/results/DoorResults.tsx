import { useState } from 'react'
import { SegmentTimeline } from '../charts/SegmentTimeline'
import { LineChart } from '../charts/LineChart'
import { SectionHead, StatTile, StatusPill } from '../StatTile'
import { fmt } from '../charts/chartUtils'
import { formatDuration } from '../../lib/doorTime'
import type { DoorResult } from '../../types'

export function DoorResults({ result }: { result: DoorResult }) {
  const [selected, setSelected] = useState<number>(-1)
  const abnormal = result.segments.filter((s) => s.prediction === 'Abnormal resistance')
  const share = result.segments.length > 0 ? abnormal.length / result.segments.length : 0

  const bands = result.segments.map((s) => ({
    from: s.startOffsetSec ?? 0,
    to: s.endOffsetSec ?? 0,
    color: s.prediction === 'Normal' ? 'var(--status-good)' : 'var(--status-critical)',
    label: `${s.operation ?? 'Cycle'} — ${s.prediction}`,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Cycles found"
          value={result.segments.length}
          hint="Door cycles the model located in the continuous stream. The stream arrives unmarked, so finding the boundaries is half the task — and the score rewards getting them tight."
        />
        <StatTile
          label="Abnormal"
          value={abnormal.length}
          sub={`${(share * 100).toFixed(0)}% of cycles`}
          tone={abnormal.length > 0 ? 'critical' : 'good'}
          hint="Cycles where the motor met more resistance than normal — debris in the slide rail, a jammed rubber strip, a deformed leaf. Left alone these lead to door jamming and motor overload."
        />
        <StatTile
          label="Stream"
          value={formatDuration(result.durationSec)}
          sub={`${result.totalRows.toLocaleString()} readings`}
          hint="How much continuous recording was analysed, and how many sensor readings it held."
        />
        <StatTile
          label="Action"
          value={abnormal.length > 0 ? 'Inspect' : 'Clear'}
          sub={abnormal.length > 0 ? 'Schedule a door check' : 'Nothing abnormal found'}
          tone={abnormal.length > 0 ? 'critical' : 'good'}
          hint="Whether this door needs a maintenance visit. Any abnormal cycle in the stream is enough to warrant a look."
        />
      </div>

      <section className="card p-4">
        <SectionHead
          title="Cycle timeline"
          hint="Each block is one door open/close cycle, positioned where it occurred in the stream and coloured by how it was classified. Click one to highlight it in the table below."
        />
        <SegmentTimeline
          segments={result.segments}
          durationSec={result.durationSec}
          selectedIndex={selected}
          onSelect={(i) => setSelected(i === selected ? -1 : i)}
        />
      </section>

      {result.trace.length > 0 && (
        <section className="card p-4">
          <SectionHead
            title="Motor current (mA)"
            hint="The motor current trace across the whole recording. Shaded spans are the detected cycles, tinted by how each was classified. Abnormal resistance shows up as extra current drawn over the same stroke."
          />
          <LineChart
            points={result.trace.map((p) => ({ t: p.t, value: p.current }))}
            xLabel="Time from start of stream (s)"
            yLabel="Motor current (mA)"
            bands={bands}
            height={240}
          />
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-hairline px-4 py-3">
          <SectionHead
            title="Cycle detail"
            hint="Exactly the rows written to door_predictions.csv, plus the evidence behind each call. 'vs threshold' is how far the cycle's mean current sat above or below the decision boundary — a number near zero was a close call."
          />
        </div>
        <div className="max-h-[26rem] overflow-auto">
          <table className="w-full text-left text-[0.72rem]">
            <thead className="sticky top-0 bg-surface text-ink-secondary">
              <tr className="border-b border-hairline">
                <th className="whitespace-nowrap px-3 py-2 font-semibold">#</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">start_time</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">end_time</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">prediction</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Operation</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Mean current (mA)</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">vs threshold</th>
              </tr>
            </thead>
            <tbody>
              {result.segments.map((s, i) => (
                <tr
                  key={i}
                  className="cursor-pointer border-b border-hairline last:border-0"
                  style={{ background: selected === i ? 'var(--page-plane)' : undefined }}
                  onClick={() => setSelected(i === selected ? -1 : i)}
                >
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-muted">{i + 1}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-secondary">{s.startTime}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-secondary">{s.endTime}</td>
                  <td className="whitespace-nowrap px-3 py-2"><StatusPill status={s.prediction} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{s.operation ?? '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">
                    {s.meanCurrent !== undefined ? fmt(s.meanCurrent, 4) : '—'}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-secondary">
                    {s.margin !== undefined ? `${s.margin >= 0 ? '+' : ''}${(s.margin * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
