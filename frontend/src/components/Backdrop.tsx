import { useLayoutEffect, useRef, type CSSProperties } from 'react'

/**
 * Ambient backdrop: an MRT running down the track, seen head-on from a camera
 * that keeps pace just ahead of it, above the roof on the track centreline.
 * When `atStation` turns on, the train brakes into a station and commuters on
 * both platforms walk across and board; when it turns off, the train pulls
 * away again. `split` narrows the scene to the left three fifths of wide screens.
 *
 * Drawn as inline SVG rather than a photo — it needs no network request, stays
 * crisp at any size, carries no licensing question, and its colours are theme
 * tokens so it re-tints itself in light and dark mode.
 *
 * Everything is placed in metres and run through one pinhole projection
 * (`project`), so the train, rails and station share a vanishing
 * point. The camera backs away at the train's speed, so the train holds still
 * while the scenery slides out from under the camera, beneath the train and
 * off toward the horizon behind it. A point (x, y, z) lands at
 * (CX, HY) + (F / z) · (x − CAM_X, EYE − y), which is a plain scale about the
 * vanishing point — so anything at a single depth is drawn once in local
 * metres and only its transform changes per frame. Positions are written
 * straight to the DOM from a requestAnimationFrame loop without re-rendering.
 * With prefers-reduced-motion nothing moves: the train simply is, or is not,
 * at the station.
 */

// Camera
const F = 840 // focal length, in viewBox units
const CX = 800 // vanishing point x: mid-screen
const HY = 400 // horizon y
const EYE = 5.2 // camera height above the rails (m) — above the roof, so it shows
const CAM_X = 0 // on the track centreline, so the view is symmetrical
const NEAR_CLIP = 0.6 // nothing closer than this is projected

// Viaduct, in metres: the track rides on a deck above the ground
const GROUND_Y = -6 // ground level, below the rails
const DECK_W = 3 // deck half width
const PARAPET = 0.9 // parapet height above the deck
const PIER_X = 7 // portal pier legs stand clear of the deck's shadow, so they show
const PIER_BEAM = -0.9 // underside of the deck, where the pier crossbeam sits

// Train, in metres
const W = 1.5 // half width
const FLOOR = 0.4
const ROOF = 3.8
const TRAIN_Z = 11 // distance from the camera to the nose
const CAR_LEN = 20
const CAR_GAP = 1.2

// Moving scenery
const Z_NEAR = 6 // just below the bottom edge of the viewport
const Z_FAR = 90 // close to the horizon
const SPEED = 5 // cruising speed, metres per second
const FRAME_MS = 1000 / 30 // a background does not need more than 30 fps
const SLEEPER_GAP = 3.5
const LINE_GAP = 21
const PIER_GAP = 28
const SLEEPERS = Math.round((Z_FAR - Z_NEAR) / SLEEPER_GAP)
const LINES = Math.round((Z_FAR - Z_NEAR) / LINE_GAP)
const PIERS = Math.round((Z_FAR - Z_NEAR) / PIER_GAP)

// Station stop
const COAST = 0.8 // seconds at speed after the station appears, before braking
const BRAKE = 2.6 // seconds from cruising speed to a stand
const DECEL = SPEED / BRAKE
const ACCEL = SPEED / 3
const STOP_DEPTH = 6 // where the platform's near end sits once stopped
const PLAT_Y = 1 // platform height
const PLAT_EDGE = 2 // platform edge, metres from the centreline
const WALK = 2.4 // boarding pace, metres per second
const BOARD_X = 1.6 // commuters vanish here, into the train's side

type V3 = [number, number, number]

function project([x, y, z]: V3): [number, number] {
  return [CX + (F * (x - CAM_X)) / z, HY + (F * (EYE - y)) / z]
}

function points(pts: V3[]) {
  return pts.map((p) => project(p).map((n) => n.toFixed(1)).join(',')).join(' ')
}

/** Transform that places local metres (y up = negative) at (x, y, z). */
function placeAt(x: number, y: number, z: number) {
  const [sx, sy] = project([x, y, z])
  return `translate(${sx} ${sy}) scale(${F / z})`
}

/** Depth of item `i` in a row spaced `gap` apart, after travelling `dist`. */
function depthAt(i: number, gap: number, dist: number) {
  const span = Z_FAR - Z_NEAR
  const z = (i * gap + dist) % span
  return Z_NEAR + (z < 0 ? z + span : z)
}

/** Fade items out as they near the horizon, so none pop when they wrap around. */
function fadeIn(z: number) {
  return Math.min(1, (Z_FAR - z) / 15)
}

// Face shading: the roof catches the most light, the front the least.
const tint = (pct: number) => `color-mix(in srgb, var(--series-1) ${pct}%, var(--page-plane))`
const GLASS = tint(40)
// The train itself is silver with a black face, like an MRT unit. Each shade is mixed
// toward the page, scaled by --train-strength, so the train sits darker in dark mode.
const metal = (hex: string, pct: number) =>
  `color-mix(in srgb, ${hex} calc(${pct}% * var(--train-strength, 1)), var(--page-plane))`
const FRONT = metal('#c4cad1', 78)
const SIDE = metal('#d3d8de', 80)
const TOP = metal('#e1e5e9', 82)
const DOOR = metal('#dde1e6', 88)
const MASK = metal('#171b20', 90)
const BUMPER = metal('#262b31', 88)
const WINDOW = metal('#3b4654', 90)
const PLATE = metal('#f4f5f7', 92)
const TRIM = metal('#9aa2ab', 85)
const LIT = '#e3f36a' // headlamp, lit
const DARK = 'var(--page-plane)'

type Face = { pts: string; fill: string; opacity?: number }

/**
 * One carriage, as the faces the camera can see, painted back to front. From
 * the centreline both sides face away, so only the roof and front show.
 */
function carriage(z0: number, nose: boolean): Face[] {
  const z1 = z0 + CAR_LEN
  const faces: Face[] = []
  // Nose profile as (height, setback): an upright face, then a rounded shoulder into the roof.
  const profile: [number, number][] = nose
    ? [
        [FLOOR, 0],
        [3.3, 0],
        [3.62, 0.3],
        [ROOF, 0.75],
      ]
    : [
        [FLOOR, 0],
        [ROOF, 0],
      ]
  const roofStart = z0 + profile[profile.length - 1][1]

  faces.push({
    pts: points([
      [-W, ROOF, roofStart],
      [W, ROOF, roofStart],
      [W, ROOF, z1],
      [-W, ROOF, z1],
    ]),
    fill: TOP,
  })
  // Front bands between consecutive profile points; the raked ones face up, so read lighter.
  for (let i = 0; i < profile.length - 1; i++) {
    const [ya, da] = profile[i]
    const [yb, db] = profile[i + 1]
    faces.push({
      pts: points([
        [-W, ya, z0 + da],
        [W, ya, z0 + da],
        [W, yb, z0 + db],
        [-W, yb, z0 + db],
      ]),
      fill: da === db ? FRONT : i === 1 ? SIDE : TOP,
    })
  }

  // Roof-mounted air-con units: a short front face and a lit top
  for (const dz of [5, 13]) {
    const [zs, ze] = [z0 + dz, z0 + dz + 3.5]
    const top = ROOF + 0.3
    faces.push({
      pts: points([
        [-0.8, ROOF, zs],
        [0.8, ROOF, zs],
        [0.8, top, zs],
        [-0.8, top, zs],
      ]),
      fill: FRONT,
    })
    faces.push({
      pts: points([
        [-0.8, top, zs],
        [0.8, top, zs],
        [0.8, top, ze],
        [-0.8, top, ze],
      ]),
      fill: metal('#eef0f3', 84),
    })
  }
  return faces
}

// Farthest carriage first, so nearer ones paint over it.
const TRAIN: Face[] = [2, 1, 0].flatMap((i) => carriage(TRAIN_Z + i * (CAR_LEN + CAR_GAP), i === 0))

// Details on the nose, drawn flat on its face in metres (y up = negative)
const NOSE_AT = placeAt(0, 0, TRAIN_Z)
const SKIRT = points([
  [-1.3, 0.05, TRAIN_Z],
  [1.3, 0.05, TRAIN_Z],
  [1.3, FLOOR, TRAIN_Z],
  [-1.3, FLOOR, TRAIN_Z],
])
// Headlamp clusters: the inner lamp of each pair lit, the outer one dark
const LAMP_Y = -1.24
const LAMP_LIT_X = 0.7
const LAMP_OFF_X = 1.02
// One beam per headlamp, each fanning wide enough to cross the centreline, so the two
// overlap (and read brighter) down the middle of the track
const BEAMS = [-1, 1].map((s) =>
  points([
    [s * (LAMP_LIT_X - 0.12), -LAMP_Y, TRAIN_Z],
    [s * (LAMP_LIT_X + 0.12), -LAMP_Y, TRAIN_Z],
    [s * 2.8, 0, TRAIN_Z - 5],
    [-s * 0.9, 0, TRAIN_Z - 5],
  ]),
)
// Each lamp breathes on its own beat, half a cycle apart
const LAMP_DELAY = ['0s', '-1.2s']

// Static ground: rails, the viaduct deck and the long lines of the ground plane
const RAILS = [-0.72, 0.72].map((x) => [project([x, 0, Z_NEAR - 2]), project([x, 0, 800])])
const GROUND = [-30, -12, 12, 30].map((x) => [
  project([x, GROUND_Y, Z_NEAR - 2]),
  project([x, GROUND_Y, 800]),
])
// The deck, and the inner faces of its parapets (the outer faces point away from the camera)
const DECK = points([
  [-DECK_W, 0, Z_NEAR - 2],
  [DECK_W, 0, Z_NEAR - 2],
  [DECK_W, 0, 800],
  [-DECK_W, 0, 800],
])
const PARAPETS = [-1, 1].map((s) =>
  points([
    [s * DECK_W, 0, Z_NEAR - 2],
    [s * DECK_W, PARAPET, Z_NEAR - 2],
    [s * DECK_W, PARAPET, 800],
    [s * DECK_W, 0, 800],
  ]),
)

// Moving items in unit coordinates (x − CAM_X, EYE − y); see the header comment.
const SLEEPER_X = [-1.3 - CAM_X, 1.3 - CAM_X]

const scaleAt = (z: number) => `translate(${CX} ${HY}) scale(${F / z})`

/*
 * The station, in metres along the track from the platform's near end (dz).
 * Spans run along the track and are re-projected every frame, clipped at the
 * camera; everything else sits at one depth and is moved by transform.
 */
type Span = { z0: number; z1: number; fill: string; opacity?: number; at: (a: number, b: number) => V3[] }
const SIDES = [-1, 1] as const
const quad = (s: number, x0: number, x1: number, y0: number, y1: number) => (a: number, b: number): V3[] =>
  y0 === y1
    ? [
        [s * x0, y0, a],
        [s * x1, y0, a],
        [s * x1, y0, b],
        [s * x0, y0, b],
      ]
    : [
        [s * x0, y0, a],
        [s * x0, y1, a],
        [s * x0, y1, b],
        [s * x0, y0, b],
      ]
const CANOPY_Y = 4.2
const STATION_SPANS: Span[] = SIDES.flatMap((s) => [
  { z0: -20, z1: 70, fill: tint(12), at: quad(s, PLAT_EDGE, PLAT_EDGE, 0, PLAT_Y) }, // edge wall
  { z0: -20, z1: 70, fill: tint(22), at: quad(s, PLAT_EDGE, 7, PLAT_Y, PLAT_Y) }, // deck
  { z0: -20, z1: 70, fill: 'var(--series-4)', opacity: 0.75, at: quad(s, 2.2, 2.4, PLAT_Y, PLAT_Y) }, // safety line
])
const CANOPY_SPANS: Span[] = SIDES.map((s) => ({
  z0: -20,
  z1: 58,
  fill: tint(28),
  opacity: 0.7,
  at: quad(s, 2.6, 7.5, CANOPY_Y, CANOPY_Y),
}))
const PILLARS = SIDES.flatMap((s) => [0, 10, 20, 30, 40, 50].map((dz) => ({ x: s * 5.5, dz })))
const SIGNS = SIDES.map((s) => ({ x: s * 6, dz: 6 })) // between pillars, so neither hides the other

// Commuters waiting on each platform: where they stand, when they set off, what they wear.
const PEOPLE = [
  { s: 1, dz: 7, x: 3.3, delay: 0, color: 'var(--series-2)' },
  { s: -1, dz: 9, x: 3.8, delay: 0.15, color: 'var(--series-3)' },
  { s: 1, dz: 12, x: 4.6, delay: 0.35, color: 'var(--series-4)' },
  { s: -1, dz: 15, x: 3.1, delay: 0.25, color: 'var(--series-2)' },
  { s: 1, dz: 18, x: 3.7, delay: 0.55, color: 'var(--series-3)' },
  { s: -1, dz: 21, x: 5.0, delay: 0.45, color: 'var(--series-4)' },
  { s: 1, dz: 26, x: 4.2, delay: 0.7, color: 'var(--series-2)' },
  { s: -1, dz: 30, x: 3.5, delay: 0.8, color: 'var(--series-3)' },
  { s: 1, dz: 35, x: 3.4, delay: 0.95, color: 'var(--series-4)' },
  { s: -1, dz: 40, x: 4.4, delay: 1.0, color: 'var(--series-2)' },
]
  // Farthest first, so nearer commuters paint over them.
  .sort((a, b) => b.dz - a.dz)
const BOARD_MS = 1000 * Math.max(...PEOPLE.map((p) => p.delay + (p.x - BOARD_X) / WALK)) + 300

/*
 * Roadside life, down on the ground below the viaduct: roads alongside the
 * railway with traffic on them, trees, and now and then a road passing under. Movers sit
 * at one depth each and wrap between LO and Z_FAR; `drift` is their own speed
 * along the track in m/s (negative = toward the camera).
 */
const LO = 2 // wrap point, below and beside the viewport
const rnd = (n: number) => {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}
const wrapDepth = (v: number) => {
  const span = Z_FAR - LO
  return LO + ((((v - LO) % span) + span) % span)
}
type Mover = { base: number; x: number; drift: number; scale: number; kind: number; color: string }

const ROAD_IN = 12
const ROAD_OUT = 19
const ROADS = SIDES.map((s) =>
  points([
    [s * ROAD_IN, GROUND_Y, LO],
    [s * ROAD_OUT, GROUND_Y, LO],
    [s * ROAD_OUT, GROUND_Y, 800],
    [s * ROAD_IN, GROUND_Y, 800],
  ]),
)
const DASH_X = (ROAD_IN + ROAD_OUT) / 2
const DASH_GAP = 15
const DASH_LEN = 3
const DASHES = Math.round((Z_FAR - Z_NEAR) / DASH_GAP)

const CAR_COLORS = ['var(--series-2)', 'var(--series-3)', 'var(--series-4)', tint(70)]
// Inner lanes run with the train, toward the camera; outer lanes run the other way.
const CARS: Mover[] = SIDES.flatMap((s, si) =>
  [
    { x: 13.8, drift: -4 },
    { x: 17.2, drift: 7 },
  ].flatMap((lane, li) =>
    [0, 1].map((k) => ({
      base: LO + ((k + rnd(si * 7 + li * 3 + k) * 0.6) * (Z_FAR - LO)) / 2,
      x: s * lane.x,
      drift: lane.drift * (0.85 + rnd(si + li * 5 + k * 11) * 0.3),
      scale: 1,
      kind: lane.drift < 0 ? 0 : 1, // 0 shows headlights, 1 shows tail lights
      color: CAR_COLORS[(si * 6 + li * 3 + k) % CAR_COLORS.length],
    })),
  ),
)

// A belt of small trees beside the line, and bigger ones out past the roads.
const TREE_COUNT = 12
const TREES: Mover[] = Array.from({ length: TREE_COUNT }, (_, i) => {
  const s = i % 2 ? 1 : -1
  const near = i % 3 === 0
  return {
    base: LO + ((i + rnd(i + 100) * 0.8) * (Z_FAR - LO)) / TREE_COUNT,
    x: s * (near ? 9.4 + rnd(i) * 1.4 : 21 + rnd(i + 50) * 24),
    drift: 0,
    scale: near ? 0.55 + rnd(i + 7) * 0.25 : 0.9 + rnd(i + 9) * 0.6,
    kind: rnd(i + 200) > 0.5 ? 1 : 0, // 0 broadleaf, 1 pine
    color: '',
  }
})
/** Indices of `list`, farthest first, so the initial paint order is back to front. */
const farFirst = (list: Mover[]) => list.map((_, i) => i).sort((a, b) => list[b].base - list[a].base)
const LEAF = 'color-mix(in srgb, var(--series-3) 55%, var(--page-plane))'
const PINE = 'color-mix(in srgb, var(--series-3) 38%, var(--page-plane))'
const TRUNK = 'color-mix(in srgb, var(--series-2) 35%, var(--page-plane))'

const CROSS_PERIOD = 190 // metres of track between roads passing under the viaduct
const CROSS_W = 8 // road width
const crossingRoad = (a: number, b: number): V3[] => [
  [-80, GROUND_Y, a],
  [80, GROUND_Y, a],
  [80, GROUND_Y, b],
  [-80, GROUND_Y, b],
]

// Sky: a city skyline on the horizon, two rows deep with lit windows, and a few clouds.
// Each layer is one path, drawn once in the static layer.
type Block = { x: number; w: number; h: number }
function blocks(seed: number, minH: number, varH: number): Block[] {
  const out: Block[] = []
  for (let x = -20, i = 0; x < 1620; i++) {
    const w = 24 + rnd(seed + i) * 36
    out.push({ x, w, h: minH + rnd(seed + 1000 + i) ** 2 * varH })
    x += w + 2 + (rnd(seed + 2000 + i) > 0.35 ? 50 + rnd(seed + 3000 + i) * 90 : 0)
  }
  return out
}
const r1 = (n: number) => n.toFixed(1)
const outline = (bs: Block[]) => bs.map((b) => `M${r1(b.x)} ${HY}V${r1(HY - b.h)}H${r1(b.x + b.w)}V${HY}Z`).join('')
const SKY_BACK = blocks(500, 34, 120)
const SKY_FRONT = blocks(300, 12, 85)
const SKYLINE_BACK = outline(SKY_BACK)
const SKYLINE_FRONT = outline(SKY_FRONT)
const SKYLINE_WINDOWS = SKY_FRONT.flatMap((b, bi) => {
  const lit: string[] = []
  for (let y = HY - b.h + 6, row = 0; y < HY - 8; y += 9, row++) {
    for (let x = b.x + 5, col = 0; x < b.x + b.w - 7; x += 8, col++) {
      if (rnd(bi * 97 + row * 13 + col) > 0.72) lit.push(`M${r1(x)} ${r1(y)}h3v4h-3Z`)
    }
  }
  return lit
}).join('')
const CLOUDS = [
  { top: 12, s: 1.4, dur: 140, at: 0 },
  { top: 22, s: 1, dur: 110, at: 40 },
  { top: 7, s: 1.1, dur: 160, at: 95 },
  { top: 28, s: 0.8, dur: 120, at: 70 },
  { top: 17, s: 1.2, dur: 150, at: 120 },
]

type Mode = 'running' | 'arriving' | 'boarding' | 'stopped' | 'departing'
type PersonEls = { g: SVGGElement | null; body: SVGGElement | null; legs: (SVGLineElement | null)[] }

export function Backdrop({ atStation = false, split = false }: { atStation?: boolean; split?: boolean }) {
  const sleepers = useRef<(SVGLineElement | null)[]>([])
  const lines = useRef<(SVGLineElement | null)[]>([])
  const piers = useRef<(SVGGElement | null)[]>([])
  const train = useRef<SVGGElement | null>(null)
  const station = useRef<SVGGElement | null>(null)
  const dashes = useRef<(SVGLineElement | null)[]>([])
  const cars = useRef<(SVGGElement | null)[]>([])
  const trees = useRef<(SVGGElement | null)[]>([])
  const crossRoadGroup = useRef<SVGGElement | null>(null)
  const crossRoad = useRef<SVGPolygonElement | null>(null)
  const spans = useRef<(SVGPolygonElement | null)[]>([])
  const canopies = useRef<(SVGPolygonElement | null)[]>([])
  const pillars = useRef<(SVGGElement | null)[]>([])
  const signs = useRef<(SVGGElement | null)[]>([])
  const people = useRef<PersonEls[]>(PEOPLE.map(() => ({ g: null, body: null, legs: [null, null] })))

  // Read from the animation loop, which is set up once.
  const wantStation = useRef(atStation)
  wantStation.current = atStation

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    // pos: metres travelled. The platform's near end sits at depth `stationAt + pos`.
    const sim = {
      mode: (atStation ? 'stopped' : 'running') as Mode,
      pos: 0,
      v: atStation ? 0 : SPEED,
      last: performance.now(),
      t: 0, // scenery clock in seconds; stands still under reduced motion
      t0: 0,
      pos0: 0,
      v0: 0,
      stationAt: atStation ? STOP_DEPTH : (null as number | null),
      shownAt: -Infinity,
      boardStart: atStation ? -Infinity : (null as number | null),
      boardEnd: null as number | null,
    }

    const place = (els: (SVGElement | null)[], gap: number, offset: number, show = (_z: number) => true) => {
      els.forEach((el, i) => {
        if (!el) return
        const z = depthAt(i + offset, gap, sim.pos)
        el.setAttribute('transform', scaleAt(z))
        el.setAttribute('opacity', show(z) ? String(fadeIn(z)) : '0')
      })
    }

    const drawSpans = (els: (SVGPolygonElement | null)[], list: Span[], near: number) => {
      list.forEach((sp, i) => {
        const el = els[i]
        if (!el) return
        const a = Math.max(near + sp.z0, NEAR_CLIP)
        const b = near + sp.z1
        if (b <= a) return el.setAttribute('points', '')
        el.setAttribute('points', points(sp.at(a, b)))
      })
    }

    const atDepth = (el: SVGElement | null, x: number, y: number, z: number) => {
      if (!el) return
      if (z < NEAR_CLIP) return el.setAttribute('opacity', '0')
      el.setAttribute('opacity', '1')
      el.setAttribute('transform', placeAt(x, y, z))
    }

    /** Draws the station and returns how visible it is, 0 to 1. */
    const drawStation = (now: number): number => {
      const g = station.current
      if (!g) return 0
      if (sim.stationAt === null) {
        g.setAttribute('opacity', '0')
        return 0
      }
      const near = sim.stationAt + sim.pos
      const opacity = Math.max(0, Math.min(1, (now - sim.shownAt) / 600, (Z_FAR - near) / 30))
      if (opacity <= 0 && sim.mode === 'running') sim.stationAt = null // left far behind
      g.setAttribute('opacity', String(opacity))
      if (opacity <= 0) return 0
      drawSpans(spans.current, STATION_SPANS, near)
      drawSpans(canopies.current, CANOPY_SPANS, near)

      PILLARS.forEach((p, i) => atDepth(pillars.current[i], p.x, PLAT_Y, near + p.dz))
      SIGNS.forEach((p, i) => atDepth(signs.current[i], p.x, PLAT_Y, near + p.dz))

      // Commuters wait until the doors open, then walk across and step aboard.
      PEOPLE.forEach((p, i) => {
        const els = people.current[i]
        let x = p.x
        let walking = false
        let t = 0
        if (sim.boardStart !== null) {
          t = ((sim.boardEnd ?? now) - sim.boardStart) / 1000 - p.delay
          if (t > 0) {
            x = Math.max(BOARD_X, p.x - WALK * t)
            walking = x > BOARD_X && sim.boardEnd === null
          }
        }
        const fade = Math.min(1, (x - BOARD_X) / 0.5)
        const z = near + p.dz
        if (!els.g) return
        if (fade <= 0 || z < NEAR_CLIP) return els.g.setAttribute('opacity', '0')
        els.g.setAttribute('opacity', String(fade))
        els.g.setAttribute('transform', placeAt(p.s * x, PLAT_Y, z))
        const stride = walking ? 0.22 * Math.sin(t * 11) : 0.08
        els.legs[0]?.setAttribute('x2', String(stride))
        els.legs[1]?.setAttribute('x2', String(-stride))
        els.body?.setAttribute('transform', `translate(0 ${walking ? -0.04 * Math.abs(Math.cos(t * 11)) : 0})`)
      })
      return opacity
    }

    // Movers keep their paint order far-to-near: one that wraps jumps to the other end of its group.
    const lastDepth = new Map<Element, number>()
    const move = (list: Mover[], els: (SVGGElement | null)[]) => {
      const span = Z_FAR - LO
      list.forEach((d, i) => {
        const el = els[i]
        if (!el) return
        const z = wrapDepth(d.base + sim.pos + d.drift * sim.t)
        const prev = lastDepth.get(el)
        const parent = el.parentNode
        if (prev !== undefined && parent) {
          if (z < prev - span / 2) parent.appendChild(el)
          else if (z > prev + span / 2) parent.insertBefore(el, parent.firstChild)
        }
        lastDepth.set(el, z)
        el.setAttribute('transform', `${placeAt(d.x, GROUND_Y, z)} scale(${d.scale})`)
        el.setAttribute('opacity', String(Math.min(fadeIn(z), (z - LO) / 3)))
      })
    }

    const drawDashes = () => {
      dashes.current.forEach((el, k) => {
        if (!el) return
        const x = (k < DASHES ? -1 : 1) * DASH_X
        const z = depthAt(k % DASHES, DASH_GAP, sim.pos)
        const [x1, y1] = project([x, GROUND_Y, z])
        const [x2, y2] = project([x, GROUND_Y, z + DASH_LEN])
        el.setAttribute('x1', String(x1))
        el.setAttribute('y1', String(y1))
        el.setAttribute('x2', String(x2))
        el.setAttribute('y2', String(y2))
        el.setAttribute('opacity', String(fadeIn(z + DASH_LEN)))
      })
    }

    /** The occasional road passing under; it gives way to the station when one is showing. */
    const drawCrossing = (stationShown: number) => {
      const near = ((((sim.pos + 70) % CROSS_PERIOD) + CROSS_PERIOD) % CROSS_PERIOD) - 20
      const opacity = Math.max(0, Math.min(fadeIn(near), 1 - stationShown))
      const hidden = opacity <= 0 || near + CROSS_W <= NEAR_CLIP
      crossRoadGroup.current?.setAttribute('opacity', hidden ? '0' : String(opacity))
      if (hidden) return
      crossRoad.current?.setAttribute('points', points(crossingRoad(Math.max(near, NEAR_CLIP), near + CROSS_W)))
    }

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - sim.last) / 1000)
      sim.last = now
      const still = reduce.matches

      if (wantStation.current && (sim.mode === 'running' || sim.mode === 'departing')) {
        if (still) {
          // No motion: be at the platform, everyone already aboard.
          Object.assign(sim, { mode: 'stopped', v: 0, stationAt: STOP_DEPTH - sim.pos, shownAt: -Infinity })
          Object.assign(sim, { boardStart: -Infinity, boardEnd: null })
        } else {
          // Coast, then brake at a constant rate so the platform ends exactly at STOP_DEPTH.
          const travel = sim.v * COAST + (sim.v * sim.v) / (2 * DECEL)
          Object.assign(sim, { mode: 'arriving', t0: now, pos0: sim.pos, v0: sim.v, shownAt: now })
          Object.assign(sim, { stationAt: STOP_DEPTH - (sim.pos + travel), boardStart: null, boardEnd: null })
        }
      } else if (!wantStation.current && sim.mode !== 'running' && sim.mode !== 'departing') {
        sim.mode = 'departing'
        if (sim.boardStart !== null && sim.boardEnd === null) sim.boardEnd = now // anyone left stays behind
        if (still) Object.assign(sim, { mode: 'running', stationAt: null })
      }

      if (!still) sim.t += dt

      switch (sim.mode) {
        case 'running':
          sim.v = still ? 0 : SPEED
          sim.pos += sim.v * dt
          break
        case 'arriving': {
          const t = (now - sim.t0) / 1000
          const braking = sim.v0 / DECEL
          if (t < COAST) {
            sim.pos = sim.pos0 + sim.v0 * t
          } else if (t < COAST + braking) {
            const u = t - COAST
            sim.v = sim.v0 - DECEL * u
            sim.pos = sim.pos0 + sim.v0 * COAST + sim.v0 * u - (DECEL * u * u) / 2
          } else {
            Object.assign(sim, { mode: 'boarding', v: 0, boardStart: now })
            sim.pos = sim.pos0 + sim.v0 * COAST + (sim.v0 * braking) / 2
          }
          break
        }
        case 'boarding':
          if (sim.boardStart !== null && now - sim.boardStart > BOARD_MS) sim.mode = 'stopped'
          break
        case 'stopped':
          break
        case 'departing':
          sim.v = Math.min(SPEED, sim.v + ACCEL * dt)
          sim.pos += sim.v * dt
          if (sim.v >= SPEED) sim.mode = 'running'
          break
      }

      // Scenery
      place(sleepers.current, SLEEPER_GAP, 0)
      place(lines.current, LINE_GAP, 0.5)
      place(piers.current, PIER_GAP, 0.25)
      move(CARS, cars.current)
      move(TREES, trees.current)
      drawDashes()
      drawCrossing(drawStation(now))

      // Rocking only while moving
      const moving = sim.v > 0.3
      train.current?.style.setProperty('animation-play-state', moving ? 'running' : 'paused')
    }

    let frame = 0
    let drawn = -Infinity
    const loop = (now: number) => {
      if (now - drawn >= FRAME_MS - 1) {
        step(now)
        drawn = now
      }
      frame = requestAnimationFrame(loop)
    }
    loop(performance.now())
    return () => cancelAnimationFrame(frame)
    // Set up once: the loop reads later prop changes through refs.
  }, [])

  return (
    <div
      // `split` keeps the scene to the left three fifths on wide screens; the slice fit re-centres the train in it.
      className={`pointer-events-none fixed inset-y-0 left-0 -z-10 w-full overflow-hidden transition-[width] duration-500 ease-out ${split ? 'lg:w-3/5' : ''}`}
      style={{ opacity: 'var(--backdrop-opacity)' }}
      aria-hidden
    >
      {/* Static layer, painted once: sky, skyline and horizon haze */}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
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
        </defs>
        <rect width="1600" height="900" fill="url(#bd-sky)" />
        <g stroke="var(--series-1)" strokeWidth="1">
          <path d={SKYLINE_BACK} strokeOpacity="0.3" style={{ fill: tint(7) }} />
          <path d={SKYLINE_FRONT} strokeOpacity="0.55" style={{ fill: tint(15) }} />
        </g>
        <path d={SKYLINE_WINDOWS} opacity="0.6" style={{ fill: 'var(--series-4)' }} />
        <ellipse cx={CX} cy={HY} rx="560" ry="140" fill="url(#bd-glow)" />
      </svg>

      {/* Clouds, moved by CSS transform on their own layers so drifting never repaints the scene */}
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className="bd-cloud absolute left-0"
          // --cloud-rest spreads the clouds out when reduced motion stops the drift.
          style={
            {
              top: `${c.top}%`,
              animationDuration: `${c.dur}s`,
              animationDelay: `${-c.at}s`,
              '--cloud-rest': `${8 + i * 19}vw`,
            } as CSSProperties
          }
        >
          <svg width={150 * c.s} height={56 * c.s} viewBox="-70 -40 140 52" opacity="0.13" style={{ fill: 'var(--series-1)' }}>
            <ellipse cx="0" cy="0" rx="62" ry="17" />
            <ellipse cx="-26" cy="-10" rx="30" ry="18" />
            <ellipse cx="20" cy="-15" rx="34" ry="22" />
          </svg>
        </div>
      ))}

      {/* The moving scene, redrawn each frame */}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="bd-lamp" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={LIT} stopOpacity="0.85" />
            <stop offset="100%" stopColor={LIT} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bd-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIT} stopOpacity="0.3" />
            <stop offset="100%" stopColor={LIT} stopOpacity="0" />
          </linearGradient>
        </defs>

        <g stroke="var(--series-1)" fill="none">
          {/* Ground plane: long lines to the vanishing point, cross lines streaming past */}
          <g opacity="0.28">
            {GROUND.map(([[x1, y1], [x2, y2]], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1" />
            ))}
            <line x1="0" y1={HY} x2="1600" y2={HY} strokeWidth="1" />
            {Array.from({ length: LINES }, (_, i) => (
              <line
                key={i}
                ref={(el) => void (lines.current[i] = el)}
                x1="-4000"
                x2="4000"
                y1={EYE - GROUND_Y}
                y2={EYE - GROUND_Y}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Roads alongside the railway, lane markings streaming past */}
          <g strokeWidth="1">
            {ROADS.map((pts, i) => (
              <polygon key={i} points={pts} style={{ fill: tint(10) }} strokeOpacity="0.5" />
            ))}
            <g strokeWidth="2" strokeLinecap="round" style={{ stroke: 'var(--series-4)' }}>
              {Array.from({ length: DASHES * 2 }, (_, i) => (
                <line key={i} ref={(el) => void (dashes.current[i] = el)} opacity="0" />
              ))}
            </g>
          </g>
          <g ref={crossRoadGroup} opacity="0" strokeWidth="1">
            <polygon ref={crossRoad} style={{ fill: tint(10) }} strokeOpacity="0.5" />
          </g>

          {/* Traffic, then trees, each painted back to front */}
          <g>
            {farFirst(CARS).map((i) => (
              <g key={i} ref={(el) => void (cars.current[i] = el)} opacity="0">
                <CarEnd color={CARS[i].color} lights={CARS[i].kind === 0 ? 'var(--series-4)' : 'var(--status-critical)'} />
              </g>
            ))}
          </g>
          <g style={{ stroke: 'var(--series-3)' }}>
            {farFirst(TREES).map((i) => (
              <g key={i} ref={(el) => void (trees.current[i] = el)} opacity="0">
                <Tree kind={TREES[i].kind} />
              </g>
            ))}
          </g>

          {/* The viaduct: portal piers down to the ground, then the deck and its parapets over them */}
          <g strokeWidth="0.06">
            {Array.from({ length: PIERS }, (_, i) => (
              <g key={i} ref={(el) => void (piers.current[i] = el)} opacity="0" style={{ fill: tint(18) }}>
                {[-1, 1].map((s) => (
                  <rect key={s} x={s * PIER_X - 0.4} y={EYE - PIER_BEAM} width="0.8" height={PIER_BEAM - GROUND_Y} />
                ))}
                <rect x={-PIER_X - 0.4} y={EYE - PIER_BEAM - 0.9} width={2 * PIER_X + 0.8} height="0.9" />
              </g>
            ))}
          </g>
          <g strokeWidth="1">
            <polygon points={DECK} style={{ fill: tint(14) }} strokeOpacity="0.5" />
            {PARAPETS.map((pts, i) => (
              <polygon key={i} points={pts} style={{ fill: tint(24) }} strokeOpacity="0.6" />
            ))}
          </g>

          {/* Track: sleepers streaming past, rails over them */}
          <g opacity="0.45">
            {Array.from({ length: SLEEPERS }, (_, i) => (
              <line
                key={i}
                ref={(el) => void (sleepers.current[i] = el)}
                x1={SLEEPER_X[0]}
                x2={SLEEPER_X[1]}
                y1={EYE}
                y2={EYE}
                strokeWidth="0.08"
              />
            ))}
          </g>
          <g strokeWidth="2.5" opacity="0.65">
            {RAILS.map(([[x1, y1], [x2, y2]], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>

          {/* The station. It stands clear of the train's outline, so it can all sit behind it. */}
          <g ref={station} opacity="0" strokeWidth="1" strokeLinejoin="round">
            {STATION_SPANS.map((sp, i) => (
              <polygon
                key={i}
                ref={(el) => void (spans.current[i] = el)}
                style={{ fill: sp.fill }}
                opacity={sp.opacity}
              />
            ))}
            {PILLARS.map((_, i) => (
              <g key={i} ref={(el) => void (pillars.current[i] = el)} opacity="0">
                <rect x="-0.15" y={-(CANOPY_Y - PLAT_Y)} width="0.3" height={CANOPY_Y - PLAT_Y} strokeWidth="0.04" style={{ fill: tint(18) }} />
              </g>
            ))}
            {SIGNS.map((_, i) => (
              <g key={i} ref={(el) => void (signs.current[i] = el)} opacity="0">
                <line x1="-0.7" y1="0" x2="-0.7" y2="-0.6" strokeWidth="0.06" />
                <line x1="0.7" y1="0" x2="0.7" y2="-0.6" strokeWidth="0.06" />
                <rect x="-1" y="-1.3" width="2" height="0.7" rx="0.08" strokeWidth="0.05" style={{ fill: 'var(--series-1)' }} />
                <text
                  x="0"
                  y="-0.8"
                  textAnchor="middle"
                  fontSize="0.38"
                  fontWeight="800"
                  letterSpacing="0.04"
                  stroke="none"
                  style={{ fill: 'var(--page-plane)', fontFamily: "'Exo 2', Inter, sans-serif" }}
                >
                  CONSOLE
                </text>
              </g>
            ))}
            {PEOPLE.map((p, i) => (
              <g key={i} ref={(el) => void (people.current[i].g = el)} opacity="0" stroke="none">
                {[0, 1].map((leg) => (
                  <line
                    key={leg}
                    ref={(el) => void (people.current[i].legs[leg] = el)}
                    x1="0"
                    y1="-0.85"
                    x2="0"
                    y2="0"
                    strokeWidth="0.13"
                    strokeLinecap="round"
                    style={{ stroke: p.color }}
                  />
                ))}
                <g ref={(el) => void (people.current[i].body = el)}>
                  <rect x="-0.23" y="-1.45" width="0.46" height="0.68" rx="0.16" style={{ fill: p.color }} />
                  <circle cx="0" cy="-1.63" r="0.15" style={{ fill: tint(65) }} />
                </g>
              </g>
            ))}
            {CANOPY_SPANS.map((sp, i) => (
              <polygon
                key={i}
                ref={(el) => void (canopies.current[i] = el)}
                style={{ fill: sp.fill }}
                opacity={sp.opacity}
              />
            ))}
          </g>

          {/* Headlight wash on the track ahead, one beam per lamp */}
          {BEAMS.map((pts, i) => (
            <polygon
              key={i}
              className="bd-lamp"
              style={{ animationDelay: LAMP_DELAY[i] }}
              points={pts}
              fill="url(#bd-beam)"
              stroke="none"
            />
          ))}

          {/* The train, rocking gently on the track while it moves */}
          <g ref={train} className="bd-sway" strokeWidth="1.5" strokeLinejoin="round" style={{ stroke: TRIM }}>
            {TRAIN.map((f, i) => (
              <polygon key={i} points={f.pts} style={{ fill: f.fill } as CSSProperties} opacity={f.opacity} />
            ))}
            <polygon points={SKIRT} style={{ fill: MASK }} />

            {/* The face: black mask, side windows, centre door with its destination plate, lamps, bumper */}
            <g transform={NOSE_AT} stroke="none">
              <rect x="-1.34" y="-3.22" width="2.68" height="1.78" rx="0.3" style={{ fill: MASK }} />
              {[-1, 1].map((s) => (
                <g key={s}>
                  <rect x={s > 0 ? 0.54 : -1.22} y="-3.0" width="0.68" height="0.86" rx="0.1" style={{ fill: WINDOW }} />
                  <line
                    x1={s * 0.95}
                    y1="-2.2"
                    x2={s * 0.74}
                    y2="-2.72"
                    strokeWidth="0.025"
                    strokeLinecap="round"
                    style={{ stroke: TRIM }}
                  />
                </g>
              ))}
              {/* Route number, top right */}
              <rect x="0.66" y="-3.15" width="0.36" height="0.1" rx="0.02" style={{ fill: 'var(--series-4)' }} opacity="0.85" />

              <path d="M-0.46 -0.98 V-2.9 Q-0.46 -3.08 -0.28 -3.08 H0.28 Q0.46 -3.08 0.46 -2.9 V-0.98 Z" style={{ fill: DOOR }} />
              <rect x="-0.38" y="-2.98" width="0.76" height="0.34" rx="0.06" style={{ fill: PLATE }} />
              <circle cx="-0.2" cy="-2.81" r="0.075" fill="none" strokeWidth="0.03" style={{ stroke: 'var(--status-critical)' }} />
              <line x1="-0.09" y1="-2.81" x2="0.27" y2="-2.81" strokeWidth="0.07" style={{ stroke: 'var(--status-critical)' }} />
              <line x1="-0.46" y1="-1.7" x2="0.46" y2="-1.7" strokeWidth="0.02" style={{ stroke: TRIM }} />

              {[-1, 1].map((s, i) => (
                <g key={s}>
                  <rect
                    x={s * ((LAMP_LIT_X + LAMP_OFF_X) / 2) - 0.36}
                    y={LAMP_Y - 0.19}
                    width="0.72"
                    height="0.38"
                    rx="0.19"
                    strokeWidth="0.03"
                    style={{ fill: BUMPER, stroke: TRIM }}
                  />
                  <circle cx={s * LAMP_OFF_X} cy={LAMP_Y} r="0.12" style={{ fill: WINDOW }} />
                  <circle
                    className="bd-lamp"
                    style={{ animationDelay: LAMP_DELAY[i] }}
                    cx={s * LAMP_LIT_X}
                    cy={LAMP_Y}
                    r="0.45"
                    fill="url(#bd-lamp)"
                  />
                  <circle cx={s * LAMP_LIT_X} cy={LAMP_Y} r="0.12" style={{ fill: LIT }} />
                </g>
              ))}

              <rect x="-1.42" y="-0.92" width="2.84" height="0.52" rx="0.12" style={{ fill: BUMPER }} />
              {[-1, 1].map((s) =>
                [-0.82, -0.72, -0.62, -0.52].map((y) => (
                  <line
                    key={`${s}${y}`}
                    x1={s * 0.62}
                    y1={y}
                    x2={s * 1.18}
                    y2={y}
                    strokeWidth="0.03"
                    style={{ stroke: TRIM }}
                  />
                )),
              )}
              {/* Coupler */}
              <rect x="-0.24" y="-0.88" width="0.48" height="0.4" rx="0.04" strokeWidth="0.025" style={{ fill: MASK, stroke: TRIM }} />
              <line x1="0" y1="-0.68" x2="0.14" y2="-0.5" strokeWidth="0.04" strokeLinecap="round" style={{ stroke: TRIM }} />
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}

/** A car seen end-on, in metres: headlights toward us, or tail lights going away. */
function CarEnd({ color, lights }: { color: string; lights: string }) {
  return (
    <g strokeWidth="0.04">
      <path d="M-0.72 -0.95 L-0.55 -1.45 L0.55 -1.45 L0.72 -0.95 Z" style={{ fill: GLASS }} />
      <rect x="-0.9" y="-0.98" width="1.8" height="0.7" rx="0.16" style={{ fill: color }} />
      <rect x="-0.8" y="-0.3" width="0.3" height="0.3" stroke="none" style={{ fill: DARK }} />
      <rect x="0.5" y="-0.3" width="0.3" height="0.3" stroke="none" style={{ fill: DARK }} />
      <rect x="-0.78" y="-0.84" width="0.3" height="0.14" rx="0.05" stroke="none" style={{ fill: lights }} />
      <rect x="0.48" y="-0.84" width="0.3" height="0.14" rx="0.05" stroke="none" style={{ fill: lights }} />
    </g>
  )
}

/** A tree in metres, roots at the origin: broadleaf (0) or pine (1). */
function Tree({ kind }: { kind: number }) {
  return (
    <g strokeWidth="0.06">
      <rect x="-0.18" y="-2" width="0.36" height="2" style={{ fill: TRUNK }} />
      {kind === 0 ? (
        <g style={{ fill: LEAF }}>
          <circle cx="-0.9" cy="-2.8" r="1" />
          <circle cx="0.9" cy="-2.9" r="1.05" />
          <circle cx="0" cy="-3.5" r="1.5" />
        </g>
      ) : (
        <g style={{ fill: PINE }}>
          <polygon points="-1.4,-1.5 0,-4 1.4,-1.5" />
          <polygon points="-1.05,-3 0,-5.4 1.05,-3" />
        </g>
      )}
    </g>
  )
}
