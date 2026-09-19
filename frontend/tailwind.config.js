/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Exo 2"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Semantic roles resolve to the CSS custom properties in index.css,
        // so light/dark swap in exactly one place (see src/index.css).
        surface: 'var(--surface-1)',
        plane: 'var(--page-plane)',
        ink: 'var(--text-primary)',
        'ink-secondary': 'var(--text-secondary)',
        'ink-muted': 'var(--text-muted)',
        hairline: 'var(--border-hairline)',
        grid: 'var(--gridline)',
        's-1': 'var(--series-1)',
        's-2': 'var(--series-2)',
        's-3': 'var(--series-3)',
        's-4': 'var(--series-4)',
        good: 'var(--status-good)',
        warning: 'var(--status-warning)',
        serious: 'var(--status-serious)',
        critical: 'var(--status-critical)',
      },
    },
  },
  plugins: [],
}
