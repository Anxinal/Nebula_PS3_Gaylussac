import { useEffect, useState } from 'react'
import { PastAnalysisMenu } from './PastAnalysisMenu'
import type { RunRecord } from '../types'

export function Header({
  onHome,
  showHome,
  showBackToAnalyse,
  onBackToAnalyse,
  showBackToDashboard,
  onBackToDashboard,
  runs,
  onSelectRun,
}: {
  onHome: () => void
  showHome: boolean
  /** On the results page: a way back to the upload console, up in the header like "Past analysis". */
  showBackToAnalyse: boolean
  onBackToAnalyse: () => void
  /** With a chart open full-size: a way back to that run's dashboard, beside "Past analysis". */
  showBackToDashboard: boolean
  onBackToDashboard: () => void
  /** Every analysis run so far, for the "Past analysis" menu. */
  runs: RunRecord[]
  onSelectRun: (id: string) => void
}) {
  return (
    <header
      className="sticky top-0 z-20 border-b border-hairline"
      style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(14px) saturate(1.2)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2.5 rounded-lg text-left transition-opacity hover:opacity-80"
          aria-label="Back to the start page"
        >
          {/* The train's own nose, seen head-on: silver body, black face mask, two lit headlamps. */}
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--series-1)" />
            <path d="M9 26V17Q9 9 16 9Q23 9 23 17V26Z" fill="#fff" />
            <rect x="9" y="25.5" width="14" height="2.6" rx="1.3" fill="#262b31" />
            <rect x="11" y="16" width="10" height="6" rx="2" fill="#171b20" />
            <circle cx="13.2" cy="19" r="1.3" fill="#e3f36a" />
            <circle cx="18.8" cy="19" r="1.3" fill="#e3f36a" />
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
          {showBackToAnalyse && (
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs font-semibold" onClick={onBackToAnalyse}>
              <span aria-hidden>←</span> Back to analyse
            </button>
          )}
          {showBackToDashboard && (
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs font-semibold" onClick={onBackToDashboard}>
              <span aria-hidden>←</span> Back to dashboard
            </button>
          )}
          <PastAnalysisMenu runs={runs} onSelect={onSelectRun} />
          <ThemeToggle />
        </div>
      </div>
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
