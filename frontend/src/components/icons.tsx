import type { SubsystemId } from '../types'

/**
 * Line-art glyphs, one per subsystem, drawn on a 24-unit grid with a single
 * stroke weight so they read as one set. They carry no meaning on their own —
 * every icon sits beside its name — so they are hidden from assistive tech.
 */
const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Train doors: a car end with its two leaves parting. */
function DoorIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 4v16" />
      <path d="M8.5 11v2M15.5 11v2" />
    </svg>
  )
}

/** ACV: a snowflake for the cooling circuit. */
function AcvIcon() {
  return (
    <svg {...base}>
      <path d="M12 2.5v19M4 7l16 10M20 7L4 17" />
      <path d="M9.4 4.2 12 6.6l2.6-2.4M9.4 19.8 12 17.4l2.6 2.4" />
    </svg>
  )
}

/** Rail corrugation: the wavy wear pattern along the railhead. */
function RailIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 9c1.6 0 1.6-3 3.2-3s1.6 3 3.2 3 1.6-3 3.2-3 1.6 3 3.2 3 1.6-3 3.2-3" />
      <path d="M2.5 18h19" />
      <path d="M6 13.5v4M12 13.5v4M18 13.5v4" />
    </svg>
  )
}

/** SHM: a stress trace crossing a damage threshold. */
function ShmIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 12h2.6l2-5.5 3 11 3-8 2.2 4.5h6.2" />
      <path d="M2.5 19.5h19" strokeDasharray="0.1 3" />
    </svg>
  )
}

export const SUBSYSTEM_ICON: Record<SubsystemId, () => JSX.Element> = {
  door: DoorIcon,
  acv: AcvIcon,
  rail: RailIcon,
  shm: ShmIcon,
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  )
}

export function UploadIcon() {
  return (
    <svg {...base} strokeWidth={1.4}>
      <path d="M12 16.5V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  )
}

export function DownloadIcon() {
  return (
    <svg {...base} strokeWidth={1.5}>
      <path d="M12 4v12.5m0 0L7.5 12M12 16.5 16.5 12" />
      <path d="M4.5 20h15" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg {...base}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 16.8v.2" />
    </svg>
  )
}
