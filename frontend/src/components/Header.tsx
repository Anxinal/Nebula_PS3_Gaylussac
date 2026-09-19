import { useEffect, useState } from 'react'
import type { BackendHealth } from '../lib/api'

export function Header({
  apiBase,
  onApiBaseChange,
  health,
  onRecheck,
  onHome,
  showHome,
}: {
  apiBase: string
  onApiBaseChange: (v: string) => void
  health: BackendHealth
  onRecheck: () => void
  onHome: () => void
  showHome: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(apiBase)
  useEffect(() => setDraft(apiBase), [apiBase])

  return (
    <header className="sticky top-0 z-20 border-b border-hairline"
      style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(14px) saturate(1.2)' }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2.5 rounded-lg text-left transition-opacity hover:opacity-80"
          aria-label="Back to the start page"
        >
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--series-1)" />
            <path d="M8 21 L12 14 L16 17 L20 9 L24 13" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20" cy="9" r="2.6" fill="#fff" />
          </svg>
          <div className="leading-tight">
            <div className="display text-sm font-bold tracking-tight text-ink">Train Condition Monitoring</div>
            <div className="eyebrow">NebulaX 2026 · Gay-Lussac's Project</div>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {showHome && (
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs font-semibold" onClick={onHome}>
              <span aria-hidden>←</span> Start
            </button>
          )}
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1.5 text-xs"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: health.reachable ? 'var(--status-good)' : 'var(--text-muted)' }}
              aria-hidden
            />
            {health.reachable ? 'Model backend' : 'Built-in baseline'}
          </button>
          <ThemeToggle />
        </div>
      </div>

      {open && (
        <div className="border-t border-hairline" style={{ background: 'var(--glass-strong)' }}>
          <div className="mx-auto max-w-6xl px-4 py-4">
            <label className="block text-xs font-medium text-ink" htmlFor="api-base">
              Model backend URL
            </label>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Empty runs the built-in baselines in your browser. Point it at the team's service to use the trained
              models — e.g. <code>http://localhost:8000</code>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="api-base"
                type="url"
                value={draft}
                placeholder="http://localhost:8000"
                onChange={(e) => setDraft(e.target.value)}
                className="min-w-[16rem] flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onApiBaseChange(draft.trim())
                  onRecheck()
                }}
              >
                Connect
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setDraft('')
                  onApiBaseChange('')
                  onRecheck()
                }}
              >
                Use baseline
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-secondary">{health.detail}</p>
          </div>
        </div>
      )}
    </header>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      const t = localStorage.getItem('nebula-theme')
      return t === 'dark' || t === 'light' ? t : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
    try {
      if (theme) localStorage.setItem('nebula-theme', theme)
      else localStorage.removeItem('nebula-theme')
    } catch {
      // Storage blocked — the theme still applies for this page load.
    }
  }, [theme])

  // Dark is this app's default, so an unset preference reads as dark.
  const isDark = theme !== 'light'

  return (
    <button
      type="button"
      className="btn-ghost !px-2.5 !py-1.5 text-xs"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      {isDark ? '☀' : '☾'}
    </button>
  )
}
