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

/** Train doors: two leaves meeting at a seam that has buckled, with a crack running off one corner. */
function DoorIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 4v5.5l-1.3 1.6 2 1.8-1.1 1.7L12 20" />
      <path d="M8.5 11v2M15.5 11v2" />
      <path d="M20.3 7.5 17.8 8.7l.8 1.4-1.3.7" strokeWidth={1.3} />
    </svg>
  )
}

/** ACV: a wall air-con unit with a drop of water leaking from its underside. */
function AcvIcon() {
  return (
    <svg {...base}>
      <rect x="2.5" y="3.5" width="19" height="8" rx="2" />
      <path d="M5.5 9h13M16.5 6h2" />
      <path fill="currentColor" fillOpacity={0.35} d="M12 12.2C12 12.2 10.55 14.08 10.55 15.24A1.45 1.45 0 0 0 13.45 15.24C13.45 14.08 12 12.2 12 12.2Z" />
      <path fill="currentColor" fillOpacity={0.35} d="M12 19.4C12 19.4 11.15 20.5 11.15 21.18A0.85 0.85 0 0 0 12.85 21.18C12.85 20.5 12 19.4 12 19.4Z" />
    </svg>
  )
}

/** Rail corrugation: track running away to the horizon, the right rail worn into deep waves and the left one snapped. */
function RailIcon() {
  return (
    <svg {...base}>
      <path d="M5 21 6.8 15.3l-.9-.4M7.4 13.4l.9.4M7.4 13.4 10.5 3.5" />
      <path d="M19 21Q20.15 19.65 18.43 19.19T17.86 17.38 17.3 15.57 16.73 13.77 16.16 11.96 15.59 10.15L13.5 3.5" />
      <path d="M4.2 17h15.6M6.6 11.5h10.8M8.4 7h7.2" />
    </svg>
  )
}

/**
 * SHM: an outlined heart broken in two down a zigzag crack, the halves drawn as separate
 * shapes and nudged apart so the crack shows as a clean gap.
 */
function ShmIcon() {
  const crack = 'L10.8 17.9 12.4 15.9 10.9 13.9 12.6 11.8 10.8 9.4Z'
  return (
    <svg {...base}>
      <path d={`M12 6.6C11.2 5 9.8 3.9 8 3.8 5.6 3.6 3.2 5.4 3 8.6 2.8 12.8 6 16.5 12 20.5${crack}`} transform="translate(-0.7 0)" />
      <path d={`M12 6.6C12.8 5 14.2 3.9 16 3.8 18.4 3.6 20.8 5.4 21 8.6 21.2 12.8 18 16.5 12 20.5${crack}`} transform="translate(0.7 0)" />
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
