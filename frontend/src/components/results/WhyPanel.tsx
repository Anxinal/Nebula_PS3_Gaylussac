import { useState } from 'react'
import type { Explanation, SubsystemResult } from '../../types'
import { InfoHint } from '../InfoHint'

/**
 * "Why the model decided this": the trained backend's own explanation for each
 * answer, in plain words first and the exact decision rules on request.
 *
 * Only the model backend sends explanations; for a baseline run, or a backend
 * that sent none, this renders nothing.
 */

interface Item {
  id: string
  label: string
  verdict: string
  /** Flagged items (faults) sort first and are marked. */
  flagged: boolean
  explanation: Explanation
}

const SHOW_FIRST = 8

export function WhyPanel({ result }: { result: SubsystemResult }) {
  const [showAll, setShowAll] = useState(false)
  const { headline, items } = collect(result)
  if (!headline && items.length === 0) return null

  const shown = showAll ? items : items.slice(0, SHOW_FIRST)
  return (
    <section className="card p-5">
      <h3 className="display flex items-center gap-1.5 text-lg font-bold tracking-tight text-ink">
        Why the model decided this
        <InfoHint label="About these explanations">
          Each answer comes from a forest of decision trees. The reasons are the splits that moved the prediction
          most, averaged over every tree that used them. Open an entry to see the exact rules and how far each one
          pushed the score.
        </InfoHint>
      </h3>

      {headline && (
        <div className="mt-3 rounded-lg border border-hairline px-4 py-3">
          <p className="text-sm font-semibold text-ink">{headline.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{capitalise(headline.explanation.plainSummary)}</p>
          {headline.explanation.note && <p className="mt-1 text-xs text-ink-muted">{headline.explanation.note}</p>}
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
          {shown.map((item) => (
            <li key={item.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden hover:bg-[color-mix(in_srgb,var(--series-1)_5%,transparent)]">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: item.flagged ? 'var(--status-critical)' : 'var(--status-good)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <strong className="text-ink">{item.label}</strong>
                      <span className="text-ink-secondary">{item.verdict}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                      {capitalise(item.explanation.plainSummary)}
                    </span>
                  </span>
                  <span aria-hidden className="mt-0.5 text-xs text-ink-muted transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <Rules explanation={item.explanation} />
              </details>
            </li>
          ))}
        </ul>
      )}

      {items.length > SHOW_FIRST && (
        <button type="button" className="btn-ghost mt-3 !px-3 !py-1.5 text-xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}

/** The decision rules behind one answer, strongest first. */
function Rules({ explanation }: { explanation: Explanation }) {
  if (explanation.topNodes.length === 0) {
    return (
      <ul className="space-y-1 px-9 pb-3 text-xs text-ink-secondary">
        {explanation.reasons.map((r, i) => (
          <li key={i}>· {r}</li>
        ))}
      </ul>
    )
  }
  const largest = Math.max(...explanation.topNodes.map((n) => Math.abs(n.contribution)), 1e-9)
  return (
    <ul className="space-y-2 px-9 pb-3">
      {explanation.topNodes.map((n, i) => (
        <li key={i} className="text-xs">
          <p className="text-ink-secondary">{capitalise(n.plain)}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] px-1.5 py-0.5 text-[0.7rem] text-ink-muted">
              {n.rule}
            </code>
            {/* Bar length is this rule's share of the strongest push; colour is its direction */}
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(Math.abs(n.contribution) / largest) * 100}%`,
                  background: n.contribution >= 0 ? 'var(--status-critical)' : 'var(--status-good)',
                }}
              />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">
              {n.contribution >= 0 ? '+' : '−'}
              {Math.abs(n.contribution).toFixed(3)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function collect(result: SubsystemResult): {
  headline: { title: string; explanation: Explanation } | null
  items: Item[]
} {
  const items: Item[] = []
  let headline: { title: string; explanation: Explanation } | null = null

  switch (result.kind) {
    case 'door':
      if (result.explanation) headline = { title: capitalise(result.summary ?? 'Door stream'), explanation: result.explanation }
      result.segments.forEach((s, i) => {
        if (!s.explanation) return
        items.push({
          id: `seg-${i}`,
          label: `Cycle ${i + 1}${s.operation ? ` · ${s.operation}` : ''}`,
          verdict: s.prediction,
          flagged: s.prediction === 'Abnormal resistance',
          explanation: s.explanation,
        })
      })
      break
    case 'acv':
      result.files.forEach((f) => {
        if (!f.explanation) return
        const top = f.cars[0]?.car
        items.push({
          id: f.fileId,
          label: f.fileId,
          verdict: top ? `Car ${top} most likely leaking` : 'No ranking',
          flagged: true,
          explanation: f.explanation,
        })
      })
      break
    case 'rail':
      result.files.forEach((f) => {
        if (!f.explanation) return
        items.push({
          id: f.fileId,
          label: f.fileId,
          verdict: f.prediction,
          flagged: f.prediction !== 'Normal',
          explanation: f.explanation,
        })
      })
      break
    case 'shm':
      result.files.forEach((f) => {
        if (!f.explanation) return
        items.push({
          id: f.fileId,
          label: f.fileId,
          verdict: `Damage D = ${f.prediction.toPrecision(3)}`,
          flagged: f.prediction >= 1,
          explanation: f.explanation,
        })
      })
      break
  }
  // Faults first, keeping the original order within each group.
  items.sort((a, b) => Number(b.flagged) - Number(a.flagged))
  return { headline, items }
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
