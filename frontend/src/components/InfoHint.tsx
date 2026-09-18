import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * An "ⓘ" the reader can hover, focus or tap to get the long version of a label,
 * so the visible copy can stay short.
 *
 * The bubble is positioned from the trigger's viewport rect rather than being
 * absolutely placed inside its parent, so it is never clipped by a scrolling
 * table or an overflow-hidden card.
 */
export function InfoHint({
  children,
  label = 'More detail',
  className = '',
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [below, setBelow] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  const place = () => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom })
    setBelow(false) // measured below once the bubble exists
  }

  // Flip under the trigger when the bubble would run off the top of the window.
  useLayoutEffect(() => {
    if (!open || !pos) return
    const h = bubbleRef.current?.offsetHeight ?? 0
    setBelow(pos.top - h - 12 < 8)
  }, [open, pos])

  const show = () => {
    place()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className={`inline-flex h-[1.15em] w-[1.15em] shrink-0 translate-y-[0.06em] items-center justify-center
                    rounded-full border text-[0.66em] font-semibold leading-none transition-colors
                    ${className}`}
        style={{
          borderColor: open ? 'var(--series-1)' : 'var(--border-hairline)',
          color: open ? 'var(--series-1)' : 'var(--text-muted)',
        }}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          open ? setOpen(false) : show()
        }}
      >
        i
      </button>

      {open && pos && (
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[19rem] max-w-[calc(100vw-2rem)] rounded-lg border
                     border-hairline px-3 py-2 text-left text-[0.8rem] font-normal leading-relaxed
                     text-ink-secondary shadow-xl"
          style={{
            left: Math.min(Math.max(pos.left, 160), window.innerWidth - 160),
            top: below ? pos.bottom + 10 : pos.top - 10,
            transform: `translate(-50%, ${below ? '0' : '-100%'})`,
            background: 'var(--glass-strong)',
            backdropFilter: 'blur(14px) saturate(1.2)',
          }}
        >
          {children}
        </span>
      )}
    </>
  )
}
