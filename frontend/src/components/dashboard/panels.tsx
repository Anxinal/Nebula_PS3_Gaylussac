import type { ReactNode } from 'react'
import { ColumnChart } from '../charts/ColumnChart'
import { LineChart } from '../charts/LineChart'
import { MultiLineChart } from '../charts/MultiLineChart'
import { SegmentTimeline } from '../charts/SegmentTimeline'
import { TrainDiagram } from '../charts/TrainDiagram'
import { fmt } from '../charts/chartUtils'
import { StatusPill } from '../StatTile'
import { DataTable } from './DataTable'
import { damageColor, probabilityColor, ramp } from '../../lib/colors'
import { formatDuration } from '../../lib/doorTime'
import type { AcvResult, DoorResult, RailLabel, RailResult, ShmResult, SubsystemResult } from '../../types'

/*
 * The dashboard for one subsystem: headline figures, then a set of chart panels,
 * each with a small version for the grid and a large one for its own page.
 *
 * Every figure and every sentence here is taken or counted from the backend's
 * reply (see lib/api.ts): totals, shares, maxima, averages and the backend's own
 * text. `about` says what a chart shows in general and carries no data; `facts`
 * are the data-derived sentences for the detail page.
 */

export interface Kpi {
  label: string
  value: string
  sub?: string
  /** Colour for the value, when it carries a verdict. */
  tone?: string
}

export interface Panel {
  id: string
  title: string
  small: ReactNode
  large: ReactNode
  about: string
  facts: string[]
  table?: ReactNode
}

export interface DashboardSpec {
  kpis: Kpi[]
  panels: Panel[]
  /** File names to choose between, when some panels show one file at a time. */
  files?: string[]
  fileNoun?: string
}

const GOOD = 'var(--status-good)'
const BAD = 'var(--status-critical)'
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listUpTo = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '))

export function buildDashboard(result: SubsystemResult, fileIndex: number): DashboardSpec {
  switch (result.kind) {
    case 'door':
      return door(result)
    case 'acv':
      return acv(result, fileIndex)
    case 'rail':
      return rail(result)
    case 'shm':
      return shm(result, fileIndex)
  }
}

// ---------------------------------------------------------------- Door

function door(r: DoorResult): DashboardSpec {
  const segs = r.segments
  const abnormal = segs.filter((s) => s.prediction === 'Abnormal resistance')
  const opens = segs.filter((s) => s.operation === 'Open').length
  const closes = segs.filter((s) => s.operation === 'Close').length
  const cycleNo = (i: number) => `#${i + 1}`
  const abnormalNos = segs.flatMap((s, i) => (s.prediction === 'Abnormal resistance' ? [cycleNo(i)] : []))

  // The backend sends each cycle's P(abnormal) and its margin to the decision threshold,
  // so the threshold itself is their difference.
  const withP = segs.flatMap((s, i) => (s.confidence !== undefined ? [{ s, i, p: s.confidence }] : []))
  const threshold =
    withP.length > 0 && withP[0].s.margin !== undefined ? withP[0].p - withP[0].s.margin : undefined
  const closest =
    threshold !== undefined
      ? withP.reduce((a, b) => (Math.abs(b.p - threshold) < Math.abs(a.p - threshold) ? b : a), withP[0])
      : undefined

  const withCurrent = segs.flatMap((s, i) => (s.meanCurrent !== undefined ? [{ s, i, c: s.meanCurrent }] : []))
  const meanAbn = mean(withCurrent.filter((x) => x.s.prediction === 'Abnormal resistance').map((x) => x.c))
  const meanNorm = mean(withCurrent.filter((x) => x.s.prediction === 'Normal').map((x) => x.c))
  const peakCycle = withCurrent.length ? withCurrent.reduce((a, b) => (b.c > a.c ? b : a)) : undefined
  const peakTrace = r.trace.length ? r.trace.reduce((a, b) => (b.current > a.current ? b : a)) : undefined

  const bands = segs.map((s) => ({
    from: s.startOffsetSec ?? 0,
    to: s.endOffsetSec ?? 0,
    color: s.prediction === 'Normal' ? GOOD : BAD,
    label: `${s.operation ?? 'Cycle'} — ${s.prediction}`,
  }))

  const table = (
    <DataTable
      columns={[
        { key: 'n', label: '#' },
        { key: 'start', label: 'start_time' },
        { key: 'end', label: 'end_time' },
        { key: 'call', label: 'prediction' },
        { key: 'op', label: 'Operation' },
        { key: 'cur', label: 'Mean current (mA)', align: 'right' },
        { key: 'p', label: 'P(abnormal)', align: 'right' },
      ]}
      rows={segs.map((s, i) => ({
        n: i + 1,
        start: s.startTime,
        end: s.endTime,
        call: <StatusPill status={s.prediction} />,
        op: s.operation ?? '—',
        cur: s.meanCurrent !== undefined ? fmt(s.meanCurrent, 4) : '—',
        p: s.confidence !== undefined ? fmt(s.confidence, 3) : '—',
      }))}
    />
  )

  const currentColumns = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : segs.length}
      data={withCurrent.map(({ s, i, c }) => ({
        label: cycleNo(i),
        value: c,
        color: s.prediction === 'Normal' ? GOOD : BAD,
        detail: `${s.operation ?? 'Cycle'} · ${s.prediction}`,
      }))}
      valueLabel="Mean current (mA)"
      categoryLabel="Door cycle"
    />
  )
  const probabilityColumns = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : segs.length}
      data={withP.map(({ s, i, p }) => ({
        label: cycleNo(i),
        value: p,
        color: probabilityColor(p),
        detail: `${s.prediction}${threshold !== undefined ? ` · threshold ${fmt(threshold, 3)}` : ''}`,
      }))}
      valueLabel="P(abnormal)"
      categoryLabel="Door cycle"
    />
  )

  const panels: Panel[] = [
    {
      id: 'timeline',
      title: 'Cycle timeline',
      small: <SegmentTimeline segments={segs} durationSec={r.durationSec} />,
      large: <SegmentTimeline segments={segs} durationSec={r.durationSec} />,
      about:
        'Each block is one door open or close cycle the model found in the continuous stream, placed where it happened and coloured by the model’s call: green for normal, red for abnormal resistance.',
      facts: [
        `${plural(segs.length, 'cycle')} found over ${formatDuration(r.durationSec)} of recording (${r.totalRows.toLocaleString()} readings).`,
        `${opens} opening and ${closes} closing.`,
        abnormal.length > 0
          ? `${plural(abnormal.length, 'cycle')} called abnormal (${pct(abnormal.length, segs.length)}): ${listUpTo(abnormalNos)}.`
          : 'No cycle was called abnormal.',
        ...(r.summary ? [`The backend’s summary: “${r.summary}”.`] : []),
      ],
      table,
    },
  ]

  if (r.trace.length > 0) {
    panels.push({
      id: 'current',
      title: 'Motor current',
      small: (
        <LineChart
          compact
          points={r.trace.map((p) => ({ t: p.t, value: p.current }))}
          xLabel="Time (s)"
          yLabel="Current (mA)"
          bands={bands}
          height={200}
        />
      ),
      large: (
        <LineChart
          points={r.trace.map((p) => ({ t: p.t, value: p.current }))}
          xLabel="Time from start of stream (s)"
          yLabel="Motor current (mA)"
          bands={bands}
          height={300}
        />
      ),
      about:
        'The door motor’s current across the whole recording, as sent by the backend (thinned out for drawing). Shaded spans are the detected cycles, tinted by the call.',
      facts: [
        `${r.trace.length.toLocaleString()} points drawn from ${r.totalRows.toLocaleString()} readings.`,
        ...(peakTrace ? [`Highest current in the trace: ${fmt(peakTrace.current, 4)} mA at ${fmt(peakTrace.t, 4)} s.`] : []),
      ],
    })
  }

  if (withCurrent.length > 0) {
    panels.push({
      id: 'mean-current',
      title: 'Mean current per cycle',
      small: currentColumns(true),
      large: currentColumns(false),
      about: 'The average motor current over each cycle, one column per cycle in stream order, coloured by the call.',
      facts: [
        ...(Number.isFinite(meanAbn) && Number.isFinite(meanNorm)
          ? [`Abnormal cycles average ${fmt(meanAbn, 4)} mA, against ${fmt(meanNorm, 4)} mA for normal ones.`]
          : []),
        ...(peakCycle ? [`Highest: cycle ${cycleNo(peakCycle.i)} at ${fmt(peakCycle.c, 4)} mA (${peakCycle.s.prediction}).`] : []),
      ],
      table,
    })
  }

  if (withP.length > 0) {
    panels.push({
      id: 'probability',
      title: 'Model confidence per cycle',
      small: probabilityColumns(true),
      large: probabilityColumns(false),
      about:
        'For each cycle, the trained model’s probability that the motor met abnormal resistance. Colour runs green (low) to red (high).',
      facts: [
        ...(threshold !== undefined
          ? [`A cycle is called abnormal when this reaches ${fmt(threshold, 3)} (the threshold implied by the backend’s margins).`]
          : []),
        ...(closest && threshold !== undefined
          ? [`Closest call: cycle ${cycleNo(closest.i)} at ${fmt(closest.p, 3)}, called ${closest.s.prediction}.`]
          : []),
        `${withP.filter((x) => x.p >= 0.9).length} of ${withP.length} cycles at 0.9 or above, where the model is most certain of a fault.`,
      ],
      table,
    })
  }

  return {
    kpis: [
      { label: 'Door cycles', value: String(segs.length), sub: `${opens} open · ${closes} close` },
      {
        label: 'Abnormal resistance',
        value: String(abnormal.length),
        sub: `${pct(abnormal.length, segs.length)} of cycles`,
        tone: abnormal.length > 0 ? BAD : GOOD,
      },
      { label: 'Recording', value: formatDuration(r.durationSec), sub: `${r.totalRows.toLocaleString()} readings` },
      closest
        ? { label: 'Closest call', value: `Cycle ${cycleNo(closest.i)}`, sub: `P(abnormal) ${fmt(closest.p, 3)}` }
        : { label: 'Action', value: abnormal.length > 0 ? 'Inspect' : 'Clear', tone: abnormal.length > 0 ? BAD : GOOD },
    ],
    panels,
  }
}

// ---------------------------------------------------------------- ACV

function acv(r: AcvResult, fileIndex: number): DashboardSpec {
  const f = r.files[Math.min(fileIndex, r.files.length - 1)]
  const top = f?.cars[0]
  const second = f?.cars[1]
  const maxScore = f ? Math.max(...f.cars.map((c) => c.score), 1e-12) : 1

  // How often each car is the top pick across every case uploaded.
  const topCounts = new Map<string, number>()
  for (const file of r.files) {
    const c = file.cars[0]?.car
    if (c) topCounts.set(c, (topCounts.get(c) ?? 0) + 1)
  }
  const mostPicked = [...topCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const scoreColumns = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      data={(f?.cars ?? []).map((c) => ({
        label: `Car ${c.car}`,
        value: c.score,
        color: ramp(c.score / maxScore),
        detail: c.evidence,
      }))}
      valueLabel="Model score"
      categoryLabel="Car, most likely leak first"
    />
  )
  const temps = (compact: boolean) =>
    f && f.series.length > 0 ? (
      <MultiLineChart
        compact={compact}
        xLabel="Sample number"
        yLabel="Indoor temperature"
        series={f.series.map((s) => ({
          name: `Car ${s.car}`,
          points: s.points,
          color: s.car === top?.car ? BAD : s.car === second?.car ? 'var(--status-warning)' : 'var(--text-muted)',
          emphasis: s.car === top?.car || s.car === second?.car,
        }))}
      />
    ) : (
      <p className="text-sm text-ink-muted">The backend sent no temperature series for this case.</p>
    )

  const rankingTable = f && (
    <DataTable
      columns={[
        { key: 'rank', label: 'Rank' },
        { key: 'car', label: 'Car' },
        { key: 'score', label: 'Model score', align: 'right' },
        { key: 'evidence', label: 'Evidence (from the backend)' },
      ]}
      rows={f.cars.map((c) => ({ rank: c.rank, car: c.car, score: fmt(c.score, 4), evidence: c.evidence }))}
    />
  )

  const panels: Panel[] = f
    ? [
        {
          id: 'train',
          title: 'Where to look first',
          small: <TrainDiagram cars={f.cars} />,
          large: <TrainDiagram cars={f.cars} />,
          about:
            'The train drawn in car order with the model’s ranking laid over it: the car most likely to be losing refrigerant is outlined in red, the runner-up in amber.',
          facts: f.cars.slice(0, 3).map((c) => `Rank ${c.rank}: Car ${c.car} — ${c.evidence}.`),
          table: rankingTable,
        },
        {
          id: 'scores',
          title: 'Model score by car',
          small: scoreColumns(true),
          large: scoreColumns(false),
          about: 'The trained model’s score for each car in this case, highest first. Colour follows the score relative to the top car.',
          facts: [
            ...(top ? [`Car ${top.car} scores ${fmt(top.score, 3)}, the highest of ${f.cars.length} cars.`] : []),
            ...(top && second
              ? [`Runner-up: Car ${second.car} at ${fmt(second.score, 3)}, ${fmt(top.score - second.score, 3)} behind.`]
              : []),
          ],
          table: rankingTable,
        },
        {
          id: 'temperature',
          title: 'Cabin temperature by car',
          small: temps(true),
          large: temps(false),
          about:
            'Each car’s indoor temperature over the case, as sent by the backend. The top-ranked car is drawn in red and the runner-up in amber; the rest are grey.',
          facts: [
            `${plural(f.series.length, 'car')} plotted from ${f.sampleCount.toLocaleString()} samples in ${f.fileId}.`,
          ],
        },
      ]
    : []

  if (r.files.length > 1) {
    panels.push({
      id: 'cases',
      title: 'Top pick in every case',
      small: (
        <ul className="space-y-1 text-sm">
          {r.files.slice(0, 6).map((file) => (
            <li key={file.fileId} className="flex justify-between gap-3">
              <span className="truncate text-ink-secondary">{file.fileId}</span>
              <span className="shrink-0 font-semibold text-ink">{file.cars[0] ? `Car ${file.cars[0].car}` : '—'}</span>
            </li>
          ))}
        </ul>
      ),
      large: (
        <DataTable
          columns={[
            { key: 'file', label: 'Case file' },
            { key: 'top', label: 'Top pick' },
            { key: 'ranking', label: 'Full ranking' },
          ]}
          rows={r.files.map((file) => ({
            file: file.fileId,
            top: file.cars[0] ? `Car ${file.cars[0].car}` : '—',
            ranking: file.cars.map((c) => c.car).join(' | '),
          }))}
        />
      ),
      about: 'The car the model ranks first in each uploaded case, and the full order it wrote to acv_predictions.csv.',
      facts: mostPicked
        ? [`Car ${mostPicked[0]} is the top pick in ${mostPicked[1]} of ${plural(r.files.length, 'case')}.`]
        : [],
    })
  }

  return {
    kpis: [
      { label: 'Case files', value: String(r.files.length) },
      { label: 'Check first', value: top ? `Car ${top.car}` : '—', sub: f?.fileId, tone: BAD },
      { label: 'Top score', value: top ? fmt(top.score, 3) : '—', sub: second ? `next: Car ${second.car} ${fmt(second.score, 3)}` : undefined },
      { label: 'Cars ranked', value: f ? String(f.cars.length) : '—', sub: f ? `${f.sampleCount.toLocaleString()} samples` : undefined },
    ],
    panels,
    files: r.files.map((x) => x.fileId),
    fileNoun: 'Case',
  }
}

// ---------------------------------------------------------------- Rail

const RAIL_COLOR: Record<RailLabel, string> = {
  Normal: GOOD,
  'Side I': BAD,
  'Side II': 'oklch(0.7 0.16 55)',
}

function rail(r: RailResult): DashboardSpec {
  const files = r.files
  const count = (l: RailLabel) => files.filter((f) => f.prediction === l).length
  const peak = (f: (typeof files)[number]) => Math.max(f.sideI, f.sideII)
  const byPeak = [...files].sort((a, b) => peak(b) - peak(a))
  const speeds = files.map((f) => f.speedKmh).filter((s): s is number => s !== null)

  const table = (
    <DataTable
      columns={[
        { key: 'file', label: 'file_id' },
        { key: 'call', label: 'prediction' },
        { key: 'p1', label: 'P(Side I corrugated)', align: 'right' },
        { key: 'p2', label: 'P(Side II corrugated)', align: 'right' },
        { key: 'conf', label: 'Confidence', align: 'right' },
        { key: 'speed', label: 'Speed (km/h)', align: 'right' },
      ]}
      rows={files.map((f) => ({
        file: f.fileId,
        call: <span style={{ color: RAIL_COLOR[f.prediction] }}>{f.prediction}</span>,
        p1: fmt(f.sideI, 3),
        p2: fmt(f.sideII, 3),
        conf: fmt(f.confidence, 3),
        speed: f.speedKmh !== null ? fmt(f.speedKmh, 3) : '—',
      }))}
    />
  )

  const split = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      data={(['Normal', 'Side I', 'Side II'] as RailLabel[]).map((l) => ({
        label: l,
        value: count(l),
        color: RAIL_COLOR[l],
        detail: `${pct(count(l), files.length)} of recordings`,
      }))}
      valueLabel="Recordings"
      categoryLabel="Model’s call"
    />
  )
  const probs = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : files.length}
      data={byPeak.map((f) => ({
        label: f.fileId,
        value: peak(f),
        color: probabilityColor(peak(f)),
        detail: `${f.prediction} · Side I ${fmt(f.sideI, 3)} · Side II ${fmt(f.sideII, 3)}`,
      }))}
      valueLabel="P(corrugated), louder rail"
      categoryLabel="Recording, most likely first"
    />
  )
  const contrast = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : files.length}
      data={[...files]
        .sort((a, b) => b.sideI - b.sideII - (a.sideI - a.sideII))
        .map((f) => ({
          label: f.fileId,
          value: f.sideI - f.sideII,
          color: f.sideI >= f.sideII ? RAIL_COLOR['Side I'] : RAIL_COLOR['Side II'],
          detail: `${f.prediction} · Side I ${fmt(f.sideI, 3)} · Side II ${fmt(f.sideII, 3)}`,
        }))}
      valueLabel="P(Side I) − P(Side II)"
      categoryLabel="Recording"
    />
  )
  const speed = (compact: boolean) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : files.length}
      data={files
        .filter((f) => f.speedKmh !== null)
        .map((f) => ({ label: f.fileId, value: f.speedKmh as number, color: RAIL_COLOR[f.prediction], detail: f.prediction }))}
      valueLabel="Speed (km/h)"
      categoryLabel="Recording"
    />
  )

  return {
    kpis: [
      { label: 'Recordings', value: String(files.length) },
      { label: 'Normal', value: String(count('Normal')), tone: GOOD },
      { label: 'Side I', value: String(count('Side I')), tone: count('Side I') > 0 ? BAD : undefined },
      { label: 'Side II', value: String(count('Side II')), tone: count('Side II') > 0 ? RAIL_COLOR['Side II'] : undefined },
    ],
    panels: [
      {
        id: 'split',
        title: 'Class split',
        small: split(true),
        large: split(false),
        about: 'How many recordings the model called Normal, corrugated on the Side I rail, or corrugated on the Side II rail.',
        facts: (['Normal', 'Side I', 'Side II'] as RailLabel[]).map(
          (l) => `${l}: ${plural(count(l), 'recording')} (${pct(count(l), files.length)}).`,
        ),
        table,
      },
      {
        id: 'probability',
        title: 'Corrugation probability',
        small: probs(true),
        large: probs(false),
        about:
          'For each recording, the model’s probability that the louder of the two rails is corrugated, most likely first. Colour runs green (low) to red (high).',
        facts: byPeak
          .slice(0, 3)
          .map(
            (f, i) =>
              `${i === 0 ? 'Most likely' : `#${i + 1}`}: ${f.fileId}, P = ${fmt(peak(f), 3)} on the Side ${f.sideI >= f.sideII ? 'I' : 'II'} rail, called ${f.prediction}.`,
          ),
        table,
      },
      {
        id: 'contrast',
        title: 'Side I vs Side II',
        small: contrast(true),
        large: contrast(false),
        about:
          'The difference between the two rails’ probabilities in each recording. Above zero, the model leans to Side I; below, to Side II.',
        facts: [
          `Side I scored higher in ${files.filter((f) => f.sideI > f.sideII).length} recordings, Side II in ${files.filter((f) => f.sideII > f.sideI).length}.`,
        ],
        table,
      },
      ...(speeds.length > 0
        ? [
            {
              id: 'speed',
              title: 'Train speed',
              small: speed(true),
              large: speed(false),
              about: 'The train’s speed during each recording, as measured by the backend from the wheel-speed signal, coloured by the call.',
              facts: [
                `Speeds range from ${fmt(Math.min(...speeds), 3)} to ${fmt(Math.max(...speeds), 3)} km/h, averaging ${fmt(mean(speeds), 3)} km/h.`,
              ],
              table,
            },
          ]
        : []),
    ],
  }
}

// ---------------------------------------------------------------- SHM

function shm(r: ShmResult, fileIndex: number): DashboardSpec {
  const files = r.files
  const f = files[Math.min(fileIndex, files.length - 1)]
  const byDamage = [...files].sort((a, b) => b.prediction - a.prediction)
  const highest = byDamage[0]
  const lowest = byDamage[byDamage.length - 1]
  const failed = files.filter((x) => x.prediction >= 1).length
  const totalBinDamage = f ? f.bins.reduce((a, b) => a + b.damage, 0) : 0
  const topBins = f ? [...f.bins].sort((a, b) => b.damage - a.damage) : []
  const topBinMax = topBins[0]?.damage || 1e-12

  const table = (
    <DataTable
      columns={[
        { key: 'file', label: 'file_id' },
        { key: 'd', label: 'Damage D', align: 'right' },
        { key: 'cycles', label: 'Rainflow cycles', align: 'right' },
        { key: 'range', label: 'Max stress range', align: 'right' },
      ]}
      rows={files.map((x) => ({
        file: x.fileId,
        d: (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: damageColor(x.prediction) }} />
            {fmt(x.prediction, 6)}
          </span>
        ),
        cycles: Math.round(x.cycles).toLocaleString(),
        range: fmt(x.maxRange, 4),
      }))}
    />
  )

  const perFile = (compact: boolean, value: (x: (typeof files)[number]) => number, label: string, sorted = true) => (
    <ColumnChart
      compact={compact}
      maxColumns={compact ? undefined : files.length}
      data={(sorted ? byDamage : files).map((x) => ({
        label: x.fileId,
        value: value(x),
        color: damageColor(x.prediction),
        detail: `D = ${fmt(x.prediction, 4)}`,
      }))}
      valueLabel={label}
      categoryLabel="Segment file, most damaged first"
    />
  )
  const bins = (compact: boolean) =>
    f && f.bins.length > 0 ? (
      <ColumnChart
        compact={compact}
        maxColumns={compact ? undefined : f.bins.length}
        data={f.bins.map((b) => ({
          label: fmt(b.rangeMid, 3),
          value: b.damage,
          color: ramp(b.damage / topBinMax),
          detail: `${Math.round(b.cycles).toLocaleString()} cycles in this band`,
        }))}
        valueLabel="Share of damage"
        categoryLabel="Stress range (band midpoint)"
      />
    ) : (
      <p className="text-sm text-ink-muted">The backend sent no stress-range bands for this file.</p>
    )

  return {
    kpis: [
      { label: 'Segments', value: String(files.length) },
      { label: 'Highest damage D', value: highest ? fmt(highest.prediction, 3) : '—', sub: highest?.fileId, tone: highest ? damageColor(highest.prediction) : undefined },
      { label: 'Mean damage D', value: fmt(mean(files.map((x) => x.prediction)), 3) },
      { label: 'At or past D = 1', value: String(failed), sub: 'Miner’s failure threshold', tone: failed > 0 ? BAD : GOOD },
    ],
    panels: [
      {
        id: 'damage',
        title: 'Damage per file',
        small: perFile(true, (x) => x.prediction, 'Damage D'),
        large: perFile(false, (x) => x.prediction, 'Cumulative damage D'),
        about:
          'The trained model’s estimate of cumulative fatigue damage for each segment, most damaged first. D = 1 is Miner’s failure threshold. Colour runs green to red on a log scale from 0.01 to 1.',
        facts: [
          ...(highest ? [`Highest: ${highest.fileId} at D = ${fmt(highest.prediction, 4)}.`] : []),
          ...(lowest && lowest !== highest ? [`Lowest: ${lowest.fileId} at D = ${fmt(lowest.prediction, 4)}.`] : []),
          `${files.filter((x) => x.prediction >= 0.5).length} of ${files.length} segments at D ≥ 0.5; ${failed} at or past D = 1.`,
        ],
        table,
      },
      {
        id: 'cycles',
        title: 'Rainflow cycles per file',
        small: perFile(true, (x) => x.cycles, 'Cycles'),
        large: perFile(false, (x) => x.cycles, 'Rainflow cycles'),
        about:
          'How many stress cycles the backend’s rainflow count found in each segment. Columns keep the damage order and colour, so you can see whether more cycles means more damage.',
        facts: [
          `From ${Math.round(Math.min(...files.map((x) => x.cycles))).toLocaleString()} to ${Math.round(Math.max(...files.map((x) => x.cycles))).toLocaleString()} cycles per segment.`,
        ],
        table,
      },
      {
        id: 'range',
        title: 'Largest stress range per file',
        small: perFile(true, (x) => x.maxRange, 'Max range'),
        large: perFile(false, (x) => x.maxRange, 'Largest stress range'),
        about:
          'The biggest single stress swing in each segment, in the units of the input file. Columns keep the damage order and colour.',
        facts: [
          `From ${fmt(Math.min(...files.map((x) => x.maxRange)), 4)} to ${fmt(Math.max(...files.map((x) => x.maxRange)), 4)}.`,
        ],
        table,
      },
      {
        id: 'bands',
        title: `Damage by stress range${f ? ` — ${f.fileId}` : ''}`,
        small: bins(true),
        large: bins(false),
        about:
          'For one segment, how its damage splits across stress-range bands, each labelled by its midpoint. Colour runs green for minor bands to red for the band carrying the most.',
        facts:
          f && topBins.length > 0 && totalBinDamage > 0
            ? [
                `The band around ${fmt(topBins[0].rangeMid, 3)} carries ${pct(topBins[0].damage, totalBinDamage)} of this file’s damage from ${Math.round(topBins[0].cycles).toLocaleString()} cycles.`,
                `The top three bands carry ${pct(topBins.slice(0, 3).reduce((a, b) => a + b.damage, 0), totalBinDamage)} between them.`,
              ]
            : [],
      },
    ],
    files: files.map((x) => x.fileId),
    fileNoun: 'Segment',
  }
}
