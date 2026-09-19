import { useEffect, useState } from 'react'

export function Header({ onHome, showHome }: { onHome: () => void; showHome: boolean }) {
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
