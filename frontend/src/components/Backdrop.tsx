/**
 * Ambient backdrop: a stylised MRT approaching down the track.
 *
 * Drawn as inline SVG rather than a photo — it needs no network request, stays
 * crisp at any size, carries no licensing question, and its strokes are theme
 * tokens so it re-tints itself in light and dark mode.
 *
 * To use a real photograph instead: drop the image in `public/`, then replace
 * the <svg> below with
 *   <img src="./mrt.jpg" alt="" className="h-full w-full object-cover" />
 * The wrapper already handles the fade, opacity and pointer transparency.
 */
export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        style={{ opacity: 'var(--backdrop-opacity)' }}
      >
        <defs>
          <linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.30" />
            <stop offset="55%" stopColor="var(--series-1)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="bd-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bd-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.4" />
            <stop offset="42%" stopColor="white" stopOpacity="0.9" />
            <stop offset="100%" stopColor="white" stopOpacity="1" />
          </linearGradient>
          <mask id="bd-mask">
            <rect width="1600" height="900" fill="url(#bd-fade)" />
          </mask>
        </defs>

        <rect width="1600" height="900" fill="url(#bd-sky)" />

        <g mask="url(#bd-mask)" stroke="var(--series-1)" fill="none" transform="translate(0 190)">
          {/* Horizon haze behind the train */}
          <ellipse cx="800" cy="470" rx="520" ry="150" fill="url(#bd-glow)" stroke="none" />

          {/* Perspective grid — the ground plane running to the vanishing point */}
          <g strokeWidth="1" opacity="0.28">
            {[-900, -620, -400, -230, -110, 110, 230, 400, 620, 900].map((dx) => (
              <line key={dx} x1={800 + dx * 1.4} y1="1140" x2={800 + dx * 0.12} y2="470" />
            ))}
            {[470, 500, 545, 610, 700, 820].map((y) => (
              <line key={y} x1="0" y1={y} x2="1600" y2={y} />
            ))}
          </g>

          {/* Track: two rails converging, with sleepers between them */}
          <g strokeWidth="2.5" opacity="0.6">
            <line x1="477" y1="1140" x2="762" y2="470" />
            <line x1="1123" y1="1140" x2="838" y2="470" />
          </g>
          <g strokeWidth="2" opacity="0.4">
            {[
              [470, 762, 838],
              [505, 744, 856],
              [552, 720, 880],
              [615, 688, 912],
              [700, 645, 955],
              [812, 590, 1010],
              [980, 520, 1080],
            ].map(([y, x1, x2]) => (
              <line key={y} x1={x1} y1={y} x2={x2} y2={y} />
            ))}
          </g>

          {/* Overhead line supports receding into the distance */}
          <g strokeWidth="2" opacity="0.32">
            {[
              [470, 40],
              [500, 70],
              [552, 118],
              [628, 196],
            ].map(([y, h]) => (
              <g key={y}>
                <line x1={800 - h * 2.1} y1={y} x2={800 - h * 2.1} y2={y - h} />
                <line x1={800 + h * 2.1} y1={y} x2={800 + h * 2.1} y2={y - h} />
                <line x1={800 - h * 2.1} y1={y - h} x2={800 + h * 2.1} y2={y - h} />
              </g>
            ))}
          </g>

          {/* The train, head-on */}
          <g strokeWidth="3" opacity="0.85">
            <path d="M672 560 L672 392 Q672 350 714 342 L886 342 Q928 350 928 392 L928 560 Z" />
            {/* Windscreen */}
            <path d="M704 392 Q704 374 726 372 L874 372 Q896 374 896 392 L896 452 L704 452 Z" strokeWidth="2.5" opacity="0.75" />
            {/* Destination panel */}
            <line x1="742" y1="358" x2="858" y2="358" strokeWidth="4" opacity="0.5" />
            {/* Headlights */}
            <circle cx="712" cy="492" r="13" strokeWidth="2.5" />
            <circle cx="888" cy="492" r="13" strokeWidth="2.5" />
            {/* Coupler housing and skirt */}
            <path d="M742 560 L742 528 L858 528 L858 560" strokeWidth="2.5" opacity="0.6" />
            {/* Carriages trailing off behind */}
            <path d="M672 470 L636 470 L636 556" strokeWidth="2" opacity="0.35" />
            <path d="M928 470 L964 470 L964 556" strokeWidth="2" opacity="0.35" />
          </g>

          {/* Motion streaks */}
          <g strokeWidth="2" opacity="0.22" strokeLinecap="round">
            {[
              [300, 430, 190],
              [250, 486, 250],
              [330, 542, 150],
              [1300, 430, 190],
              [1350, 486, 250],
              [1270, 542, 150],
            ].map(([x, y, len], i) => (
              <line key={i} x1={x} y1={y} x2={x + (x < 800 ? -len : len)} y2={y} />
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}
