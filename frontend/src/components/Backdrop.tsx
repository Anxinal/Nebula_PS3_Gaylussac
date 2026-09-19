import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'

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
const STREET_LAMP_GAP = 21 // divides the 84 m loop evenly: four lamps a side
const STREET_LAMPS = Math.round((Z_FAR - Z_NEAR) / STREET_LAMP_GAP)
const STREET_LAMP_X = 11.4 // on the inner kerb of each road, the arm reaching out over it
const STREET_GLOW = '#ffd27a' // warm sodium-ish light

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

// Draw distance: moving scenery is solid up to FADE_FROM metres away and gone by FADE_TO,
// well short of the horizon, so the view down the line stays uncluttered.
const FADE_FROM = 55
const FADE_TO = 78

/** Fade items out with distance, so none pop when they wrap around out of sight. */
function fadeIn(z: number) {
  return Math.max(0, Math.min(1, (FADE_TO - z) / (FADE_TO - FADE_FROM)))
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
// Rubber: near black in both themes, not the page colour (which is white in light mode)
const TYRE = 'color-mix(in srgb, #16191d 88%, var(--page-plane))'

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
/*
 * Each road is one-way with two lanes: the left road runs with the train, toward the
 * camera; the right road runs the other way. Cars keep their own speed, and a faster
 * car that closes on a slower one in its lane pulls into the other lane to pass it,
 * then drifts back to its home lane once there is room.
 */
const LANES = [13.8, 17.2] // inner, outer, distance from the centreline
const LANE_SHIFT = 2.8 // sideways speed of a lane change, m/s
const PASS_GAP = 10 // how close behind a slower car before pulling out
const CLEAR_GAP = 7 // room needed alongside in the lane being moved into
const FOLLOW_GAP = 5.5 // closest a car sits behind another, nose to nose (they are drawn end-on)
const BUS_GAP = 4 // extra room when a bus is either leader or follower, for its length
const CAR_ACCEL = 2.5 // m/s², speeding back up
const CAR_BRAKE = 7 // m/s², slowing for the vehicle ahead
type Car = Mover & { side: number; home: number; bus?: boolean }
const CARS: Car[] = SIDES.flatMap((s, si) => {
  const dir = s < 0 ? -1 : 1
  // Four per road: a bus and a faster car sharing the inner lane, so there are overtakes, and two outside.
  return [
    { home: 0, speed: 3.2, at: 0 },
    { home: 0, speed: 6, at: 0.4 },
    { home: 1, speed: 5, at: 0.6 },
    { home: 1, speed: 6.6, at: 0.2 },
  ].map((c, k) => ({
    base: LO + (c.at + rnd(si * 7 + k) * 0.15) * (Z_FAR - LO),
    x: s * LANES[c.home],
    drift: dir * c.speed,
    scale: 1,
    kind: dir < 0 ? 0 : 1, // 0 shows headlights, 1 shows tail lights
    color: CAR_COLORS[(si * 4 + k) % CAR_COLORS.length],
    side: s,
    home: c.home,
    bus: k === 0, // a bus on each road, the slowest vehicle, so cars stream past it
  }))
})

// Now and then someone on the footpaths outside the roads: two walkers and one cyclist.
// Kind 0 walks, 1 cycles; drift is their own pace along the track.
const PEOPLE_OUT: Mover[] = [
  { base: LO + 20, x: -20.6, drift: -1.3, scale: 1, kind: 0, color: 'var(--series-2)' },
  { base: LO + 62, x: 20.8, drift: 1.4, scale: 1, kind: 0, color: 'var(--series-4)' },
  { base: LO + 45, x: 21.6, drift: -2.6, scale: 1, kind: 1, color: 'var(--series-1)' },
]

// A belt of small trees beside the line, and bigger ones out past the roads.
const TREE_COUNT = 11
const TREES: Mover[] = Array.from({ length: TREE_COUNT }, (_, i) => {
  const s = i % 2 ? 1 : -1
  const near = i % 3 === 0
  return {
    base: LO + ((i + rnd(i + 100) * 0.8) * (Z_FAR - LO)) / TREE_COUNT,
    x: s * (near ? 9.4 + rnd(i) * 1.4 : 24.5 + rnd(i + 50) * 22), // far ones stand back from the footpaths
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

const CROSS_PERIOD = 100 // metres of track between roads passing under the viaduct; no less, so it wraps round beyond FADE_TO
const CROSS_W = 8 // road width
/*
 * Where the cross road meets each side road, a Singapore-style yellow box junction: the
 * box outline with one big cross corner to corner, and a white stop line across the side
 * road on either side of it. Segments are in a unit square (u across the side road, v
 * along the cross road) and mapped onto the ground every frame.
 */
const BOX_YELLOW = 'color-mix(in srgb, #d9ae2b 75%, var(--page-plane))' // muted, so it does not glare
type Seg = { at: [number, number, number, number]; stop?: boolean }
// Zebra crossings between each stop line and the box: bars running with the traffic,
// spaced across the side road. [x from the road's inner edge, v0, v1] per bar.
const ZEBRA: [number, number, number][] = [-0.42, 1.1].flatMap((v0) =>
  Array.from({ length: 7 }, (_, k): [number, number, number] => [0.25 + k, v0, v0 + 0.32]),
)
const ZEBRA_W = 0.5 // bar width, metres
// A traffic light on the outer corner of each road, on the side its traffic arrives from:
// the left road runs toward the camera, so its light stands at the far edge of the junction.
const SIGNALS = [
  { x: -(ROAD_OUT + 0.8), v: 1.5 },
  { x: ROAD_OUT + 0.8, v: -0.5 },
]
const SIGNAL_CYCLE = 14 // seconds: green, then amber, then red
const signalPhase = (t: number) => {
  const c = t % SIGNAL_CYCLE
  return c < 6 ? 2 : c < 8 ? 1 : 0 // index into the lamps, top to bottom: red, amber, green
}
const SIGNAL_LAMPS = ['var(--status-critical)', '#e0a100', 'var(--status-good)']
const JUNCTION: Seg[] = [
  { at: [0, 0, 1, 0] },
  { at: [1, 0, 1, 1] },
  { at: [1, 1, 0, 1] },
  { at: [0, 1, 0, 0] },
  { at: [0, 0, 1, 1] },
  { at: [1, 0, 0, 1] },
  { at: [0, -0.5, 1, -0.5], stop: true },
  { at: [0, 1.5, 1, 1.5], stop: true },
]
const crossingRoad = (a: number, b: number): V3[] => [
  [-80, GROUND_Y, a],
  [80, GROUND_Y, a],
  [80, GROUND_Y, b],
  [-80, GROUND_Y, b],
]

// Sky: a skyline on the horizon loosely after Singapore's bay (a hotel of three towers under
// one long roof, a cluster of office towers, a dome, the Merlion and an observation wheel) in front of a
// low haze of far buildings, plus a few clouds. Each layer is one path, drawn once in the
// static layer, and the silhouettes carry no windows, which keeps the path count low.
type Block = { x: number; w: number; h: number }
const r1 = (n: number) => n.toFixed(1)
const outline = (bs: Block[]) => bs.map((b) => `M${r1(b.x)} ${HY}V${r1(HY - b.h)}H${r1(b.x + b.w)}V${HY}Z`).join('')
// Far haze: a few wide, low blocks with open sky between them.
const SKY_BACK: Block[] = []
for (let x = 120, i = 0; x < 1480; i++) {
  const w = 60 + rnd(500 + i) * 70
  SKY_BACK.push({ x, w, h: 18 + rnd(1500 + i) * 34 })
  x += w + 20 + rnd(2500 + i) * 80
}
const SKYLINE_BACK = outline(SKY_BACK)
// Office towers: [x, width, height]
const TOWERS: [number, number, number][] = [
  [700, 30, 70],
  [734, 24, 96],
  [762, 34, 126],
  [800, 22, 150],
  [826, 30, 112],
  [860, 26, 166],
  [890, 36, 130],
  [930, 24, 100],
  [958, 30, 80],
  [992, 40, 58],
  [1186, 26, 96],
  [1216, 20, 70],
  [1240, 34, 112],
  [1278, 24, 82],
]
const WHEEL = { cx: 1118, cy: 332, r: 60 }
const SKYLINE_FRONT = [
  // Dome
  `M322 ${HY}Q386 ${HY - 64} 450 ${HY}Z`,
  // Three leaning towers, then the long roof across their tops
  `M528 ${HY}L535 282H556L559 ${HY}Z`,
  `M573 ${HY}L577 282H599L600 ${HY}Z`,
  `M615 ${HY}L619 282H641L641 ${HY}Z`,
  'M504 282L511 271H670L666 282Z',
  outline(TOWERS.map(([x, w, h]) => ({ x, w, h }))),
  // The wheel's base building
  `M1082 ${HY}V${HY - 12}H1156V${HY}Z`,
  // The Merlion, facing right: a wave-topped pedestal, then one outline running from the
  // curled fish tail up the back, round a scalloped mane, over an open-mouthed lion's head
  // and down its chest
  'M446 400V392Q452 386 460 390Q468 394 476 390Q484 386 492 392V400Z',
  'M456 391C450 390 446 384 446 376C450 380 454 383 457 384C455 372 456 360 459.6 352A3.5 3.5 0 0 1 458 346.6A3.5 3.5 0 0 1 459.1 341.1A3.5 3.5 0 0 1 462.5 336.6A3.5 3.5 0 0 1 467.6 334.2A3.5 3.5 0 0 1 473.3 334.4A3.5 3.5 0 0 1 478.2 337.2A3.5 3.5 0 0 1 481.3 341.9L485 345L487.5 348L483.5 349.4L486.8 352L482 354.2C479 355.5 477.6 356.5 477 358C481 366 481 380 478 391Z',
].join('')
// Window slots in the office towers and the hotel, each a small square that can be lit.
// A timer switches a random handful on or off every few seconds (see WINDOW_MIN_ON).
const WINDOWS = [
  ...TOWERS.map(([x, w, h]) => ({ x, w, h })),
  { x: 535, w: 21, h: 118 },
  { x: 577, w: 22, h: 118 },
  { x: 619, w: 22, h: 118 },
].flatMap((b, bi) => {
  const slots: { x: number; y: number; on: boolean }[] = []
  for (let y = HY - b.h + 8, row = 0; y < HY - 10; y += 11, row++) {
    for (let x = b.x + 5, col = 0; x < b.x + b.w - 7; x += 9, col++) {
      const seed = bi * 131 + row * 17 + col * 7
      if (rnd(seed) > 0.7) slots.push({ x, y, on: rnd(seed + 5) > 0.4 })
    }
  }
  return slots
})
const WINDOW_MIN_ON = 0.3 // never fewer than this share of windows lit
const WINDOW_FLIP = 0.2 // share of windows flipped at each change
// The Merlion's jet of water, arcing from its mouth into the bay.
const SKYLINE_SPOUT = 'M486.5 350.5Q506 346 518 400'
const MERLION_EYE = [478, 347]
// The wheel's rim, hub and legs: strokes only, so it reads as a ring against the sky.
const SKYLINE_WHEEL =
  `M${WHEEL.cx - WHEEL.r} ${WHEEL.cy}a${WHEEL.r} ${WHEEL.r} 0 1 0 ${2 * WHEEL.r} 0a${WHEEL.r} ${WHEEL.r} 0 1 0 ${-2 * WHEEL.r} 0` +
  `M${WHEEL.cx - 20} ${HY - 12}L${WHEEL.cx} ${WHEEL.cy}L${WHEEL.cx + 20} ${HY - 12}`
// Eight spokes and a cabin at the end of each. They are 45° symmetric, so the wheel's
// animation can loop on an eighth of a turn without a visible jump.
const WHEEL_ANGLES = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)
const WHEEL_SPOKES = WHEEL_ANGLES.map(
  (a) => `M${WHEEL.cx} ${WHEEL.cy}L${r1(WHEEL.cx + WHEEL.r * Math.cos(a))} ${r1(WHEEL.cy + WHEEL.r * Math.sin(a))}`,
).join('')
const WHEEL_CABINS = WHEEL_ANGLES.map((a) => [WHEEL.cx + WHEEL.r * Math.cos(a), WHEEL.cy + WHEEL.r * Math.sin(a)])
// Sun or moon, placed right of centre so it stays in view when the scene is narrowed to the left.
const SKY_BODY = [1160, 150]
const STARS = [
  [520, 90, 1.6],
  [640, 190, 1.2],
  [760, 70, 1.4],
  [900, 230, 1.1],
  [1180, 80, 1.5],
  [1260, 240, 1.2],
  [420, 210, 1.1],
]
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
  const streetLamps = useRef<(SVGGElement | null)[]>([])
  const train = useRef<SVGGElement | null>(null)
  const station = useRef<SVGGElement | null>(null)
  const dashes = useRef<(SVGLineElement | null)[]>([])
  const cars = useRef<(SVGGElement | null)[]>([])
  const trees = useRef<(SVGGElement | null)[]>([])
  const passers = useRef<(SVGGElement | null)[]>([])
  const passerLegs = useRef<(SVGLineElement | null)[][]>(PEOPLE_OUT.map(() => [null, null]))
  const crossRoadGroup = useRef<SVGGElement | null>(null)
  const crossRoad = useRef<SVGPolygonElement | null>(null)
  const boxLines = useRef<(SVGLineElement | null)[]>([])
  const zebras = useRef<(SVGPolygonElement | null)[]>([])
  const signalGroup = useRef<SVGGElement | null>(null)
  const signals = useRef<(SVGGElement | null)[]>([])
  const signalLamps = useRef<(SVGCircleElement | null)[][]>(SIGNALS.map(() => [null, null, null]))
  const spans = useRef<(SVGPolygonElement | null)[]>([])
  const canopies = useRef<(SVGPolygonElement | null)[]>([])
  const pillars = useRef<(SVGGElement | null)[]>([])
  const signs = useRef<(SVGGElement | null)[]>([])
  const people = useRef<PersonEls[]>(PEOPLE.map(() => ({ g: null, body: null, legs: [null, null] })))

  // Read from the animation loop, which is set up once.
  const wantStation = useRef(atStation)
  wantStation.current = atStation

  // Every 3–5 s, flip a random handful of windows, keeping at least WINDOW_MIN_ON of them lit.
  const windowEls = useRef<(SVGRectElement | null)[]>([])
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const on = WINDOWS.map((w) => w.on)
    let timer = 0
    const flip = () => {
      const count = Math.max(1, Math.round(WINDOWS.length * WINDOW_FLIP))
      for (let n = 0; n < count; n++) {
        const i = Math.floor(Math.random() * WINDOWS.length)
        const lit = on.filter(Boolean).length
        if (on[i] && lit - 1 < WINDOWS.length * WINDOW_MIN_ON) continue
        on[i] = !on[i]
        windowEls.current[i]?.setAttribute('opacity', on[i] ? '1' : '0')
      }
      timer = window.setTimeout(flip, 3000 + Math.random() * 2000)
    }
    timer = window.setTimeout(flip, 3000 + Math.random() * 2000)
    return () => window.clearTimeout(timer)
  }, [])

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
    // `depth` overrides where a mover is, for the cars, which set their own pace.
    const move = (list: Mover[], els: (SVGGElement | null)[], depth?: (i: number) => number) => {
      const span = Z_FAR - LO
      list.forEach((d, i) => {
        const el = els[i]
        if (!el) return
        const z = depth ? depth(i) : wrapDepth(d.base + sim.pos + d.drift * sim.t)
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

    // Lane each car is heading for, and where it is across the road right now (metres from the centreline).
    // Where the junction's near edge is, and whether it is showing (set as it is drawn).
    const crossingNear = () => ((((sim.pos + 70) % CROSS_PERIOD) + CROSS_PERIOD) % CROSS_PERIOD) - 20
    let crossingLive = false

    const carLane = CARS.map((c) => c.home)
    const carX = CARS.map((c) => LANES[c.home])
    // Each car's own speed (m/s, unsigned) and how far it has driven, so it can slow down and queue.
    const carV = CARS.map((c) => Math.abs(c.drift))
    const carRun = CARS.map(() => 0)
    const moveCars = (dt: number, still: boolean) => {
      const zs = CARS.map((c, i) => wrapDepth(c.base + sim.pos + carRun[i]))
      /** How far `o` is ahead of car `i` along its direction of travel; negative when behind. */
      const gapTo = (i: number, j: number) => (zs[j] - zs[i]) * Math.sign(CARS[i].drift)
      const room = (i: number, j: number) => FOLLOW_GAP + (CARS[i].bus || CARS[j].bus ? BUS_GAP : 0)
      if (!still) {
        // Is anything in `lane` on this car's road within `ahead` metres in front, or `near` metres either way?
        const occupied = (i: number, lane: number, ahead: number, near: number, slowerOnly: boolean) =>
          CARS.some((o, j) => {
            if (j === i || o.side !== CARS[i].side) return false
            if (carLane[j] !== lane && Math.abs(carX[j] - LANES[lane]) > 1.2) return false
            if (slowerOnly && carV[j] >= Math.abs(CARS[i].drift) - 0.3) return false
            const gap = gapTo(i, j)
            return (gap > 0 && gap < ahead + room(i, j) - FOLLOW_GAP) || Math.abs(gap) < near + room(i, j) - FOLLOW_GAP
          })
        CARS.forEach((c, i) => {
          // Pull out to pass a slower vehicle when the other lane is clear; drift home once there is room.
          const other = 1 - carLane[i]
          if (occupied(i, carLane[i], PASS_GAP, 0, true)) {
            if (!occupied(i, other, CLEAR_GAP, CLEAR_GAP, false)) carLane[i] = other
          } else if (carLane[i] !== c.home && !occupied(i, c.home, PASS_GAP, CLEAR_GAP, false)) {
            carLane[i] = c.home
          }
          const stepX = LANE_SHIFT * dt
          carX[i] += Math.max(-stepX, Math.min(stepX, LANES[carLane[i]] - carX[i]))

          // Follow whatever is nearest ahead and overlapping sideways: no faster than it once
          // close, and stopped short of its bumper when the lane beside is not free.
          let target = Math.abs(c.drift)
          CARS.forEach((o, j) => {
            if (j === i || o.side !== c.side || Math.abs(carX[j] - carX[i]) > 2.4) return
            const gap = gapTo(i, j)
            if (gap <= 0 || gap > PASS_GAP + room(i, j)) return
            target = Math.min(target, Math.max(0, carV[j] + (gap - room(i, j)) * 0.9))
          })
          // Stop at the line on red, and on amber unless too close to stop (then go through).
          const phase = signalPhase(sim.t)
          if (crossingLive && phase !== 2) {
            const sg = SIGNALS[c.side < 0 ? 0 : 1]
            const toLine = (crossingNear() + sg.v * CROSS_W - zs[i]) * Math.sign(c.drift)
            if (toLine > (phase === 1 ? 4 : 0.5) && toLine < 30) target = Math.min(target, Math.max(0, (toLine - 1) * 0.9))
          }
          carV[i] = target < carV[i] ? Math.max(target, carV[i] - CAR_BRAKE * dt) : Math.min(target, carV[i] + CAR_ACCEL * dt)
          carRun[i] += Math.sign(c.drift) * carV[i] * dt
        })
      }
      CARS.forEach((c, i) => {
        c.x = c.side * carX[i]
      })
      move(CARS, cars.current, (i) => wrapDepth(CARS[i].base + sim.pos + carRun[i])) // at their current place across the road
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
      const near = crossingNear()
      const opacity = Math.max(0, Math.min(fadeIn(near), 1 - stationShown))
      const hidden = opacity <= 0 || near + CROSS_W <= NEAR_CLIP
      crossingLive = !hidden
      crossRoadGroup.current?.setAttribute('opacity', hidden ? '0' : String(opacity))
      signalGroup.current?.setAttribute('opacity', hidden ? '0' : String(opacity))
      if (hidden) return
      crossRoad.current?.setAttribute('points', points(crossingRoad(Math.max(near, NEAR_CLIP), near + CROSS_W)))
      // The box junctions only show once the whole junction, stop lines included, is in front of the camera.
      SIDES.forEach((s, si) =>
        JUNCTION.forEach(({ at: [u0, v0, u1, v1] }, k) => {
          const el = boxLines.current[si * JUNCTION.length + k]
          if (!el) return
          if (near - 0.5 * CROSS_W < NEAR_CLIP) return el.setAttribute('opacity', '0')
          const at = (u: number, v: number) =>
            project([s * (ROAD_IN + u * (ROAD_OUT - ROAD_IN)), GROUND_Y, near + v * CROSS_W])
          const [x1, y1] = at(u0, v0)
          const [x2, y2] = at(u1, v1)
          el.setAttribute('x1', x1.toFixed(1))
          el.setAttribute('y1', y1.toFixed(1))
          el.setAttribute('x2', x2.toFixed(1))
          el.setAttribute('y2', y2.toFixed(1))
          el.setAttribute('opacity', '1')
        }),
      )
      // Zebra bars, projected as ground quads
      const zebraShown = near - 0.5 * CROSS_W >= NEAR_CLIP
      SIDES.forEach((s, si) =>
        ZEBRA.forEach(([dx, v0, v1], k) => {
          const el = zebras.current[si * ZEBRA.length + k]
          if (!el) return
          if (!zebraShown) return el.setAttribute('points', '')
          const x0 = s * (ROAD_IN + dx)
          const x1 = s * (ROAD_IN + dx + ZEBRA_W)
          const [z0, z1] = [near + v0 * CROSS_W, near + v1 * CROSS_W]
          el.setAttribute('points', points([[x0, GROUND_Y, z0], [x1, GROUND_Y, z0], [x1, GROUND_Y, z1], [x0, GROUND_Y, z1]]))
        }),
      )
      // Traffic lights: placed at their corners, lamps lit in turn
      const lit = signalPhase(sim.t)
      SIGNALS.forEach((sg, i) => {
        atDepth(signals.current[i], sg.x, GROUND_Y, near + sg.v * CROSS_W)
        signalLamps.current[i].forEach((lamp, k) => lamp?.setAttribute('opacity', k === lit ? '1' : '0.18'))
      })
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
      place(streetLamps.current, STREET_LAMP_GAP, 0.6)
      moveCars(dt, still)
      move(PEOPLE_OUT, passers.current)
      // Walkers step: seen from ahead or behind, each foot lifts in turn. Cyclists pedal: the
      // feet go up and down opposite each other. Each keeps its own rhythm.
      PEOPLE_OUT.forEach((p, i) => {
        const [a, b] = passerLegs.current[i]
        if (p.kind === 0) {
          const phase = still ? 0 : Math.sin(sim.t * 7 + i * 1.7)
          a?.setAttribute('y1', String(-0.16 * Math.max(0, phase)))
          b?.setAttribute('y1', String(-0.16 * Math.max(0, -phase)))
        } else {
          const phase = still ? 0 : Math.sin(sim.t * 5 + i)
          a?.setAttribute('y1', String(-0.45 - 0.16 * phase))
          b?.setAttribute('y1', String(-0.45 + 0.16 * phase))
        }
      })
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
      className={`pointer-events-none fixed inset-y-0 left-0 -z-10 w-full overflow-hidden transition-[width] duration-300 ease-out ${split ? 'lg:w-3/5' : ''}`}
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
          <radialGradient id="bd-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd84a" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ffd84a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bd-moon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f6e39a" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f6e39a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bd-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#bd-sky)" />
        {/* Sun by day, moon and a few stars by night; --daylight picks which shows */}
        <g style={{ opacity: 'var(--daylight, 1)' }}>
          <circle cx={SKY_BODY[0]} cy={SKY_BODY[1]} r="95" fill="url(#bd-sun)" />
          <circle cx={SKY_BODY[0]} cy={SKY_BODY[1]} r="32" fill="#ffd84a" />
        </g>
        <g style={{ opacity: 'calc(1 - var(--daylight, 1))' }}>
          <circle cx={SKY_BODY[0]} cy={SKY_BODY[1]} r="85" fill="url(#bd-moon)" />
          <circle cx={SKY_BODY[0]} cy={SKY_BODY[1]} r="30" fill="#f6e39a" opacity="0.92" />
          {/* A couple of soft craters */}
          <circle cx={SKY_BODY[0] - 9} cy={SKY_BODY[1] - 7} r="6" fill="#d9c374" opacity="0.45" />
          <circle cx={SKY_BODY[0] + 10} cy={SKY_BODY[1] + 9} r="4" fill="#d9c374" opacity="0.4" />
          {STARS.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity="0.7" />
          ))}
        </g>
        <g stroke="var(--series-1)" strokeWidth="1">
          <path d={SKYLINE_BACK} strokeOpacity="0.3" style={{ fill: tint(7) }} />
          <path d={SKYLINE_FRONT} strokeOpacity="0.55" style={{ fill: tint(15) }} />
          <path d={SKYLINE_WHEEL} strokeOpacity="0.5" fill="none" />
          <g className="bd-wheel" style={{ transformOrigin: `${WHEEL.cx}px ${WHEEL.cy}px` }}>
            <path d={WHEEL_SPOKES} strokeOpacity="0.35" fill="none" />
            {WHEEL_CABINS.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3.2" strokeOpacity="0.5" style={{ fill: tint(15) }} />
            ))}
          </g>
          {/* Windows glow brighter at night; a timer switches different ones on and off */}
          <g stroke="none" style={{ fill: 'var(--series-4)', opacity: 'calc(0.85 - 0.45 * var(--daylight, 1))' }}>
            {WINDOWS.map((w, i) => (
              <rect key={i} ref={(el) => void (windowEls.current[i] = el)} x={w.x} y={w.y} width="3" height="4" opacity={w.on ? 1 : 0} />
            ))}
          </g>
          <path d={SKYLINE_SPOUT} strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 4" fill="none" />
          <circle cx={MERLION_EYE[0]} cy={MERLION_EYE[1]} r="1.3" stroke="none" style={{ fill: 'var(--page-plane)' }} />
        </g>
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
            <stop offset="0%" stopColor={LIT} stopOpacity="0.6" />
            <stop offset="70%" stopColor={LIT} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bd-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIT} stopOpacity="0.2" />
            <stop offset="55%" stopColor={LIT} stopOpacity="0" />
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
            <g stroke="none" style={{ fill: 'color-mix(in srgb, var(--text-primary) 40%, var(--page-plane))' }} opacity="0.75">
              {SIDES.flatMap((_, si) =>
                ZEBRA.map((_, k) => <polygon key={`${si}-${k}`} ref={(el) => void (zebras.current[si * ZEBRA.length + k] = el)} />),
              )}
            </g>
            <g strokeWidth="1.5" strokeLinecap="round">
              {SIDES.flatMap((_, si) =>
                JUNCTION.map((seg, k) => (
                  <line
                    key={`${si}-${k}`}
                    ref={(el) => void (boxLines.current[si * JUNCTION.length + k] = el)}
                    opacity="0"
                    strokeDasharray={seg.stop ? '4 3' : undefined}
                    style={{ stroke: seg.stop ? 'color-mix(in srgb, var(--text-primary) 45%, var(--page-plane))' : BOX_YELLOW }}
                    strokeOpacity={seg.stop ? 0.7 : 0.8}
                  />
                )),
              )}
            </g>
          </g>

          {/* Traffic, then trees, each painted back to front */}
          <g>
            {farFirst(CARS).map((i) => (
              <g key={i} ref={(el) => void (cars.current[i] = el)} opacity="0">
                {CARS[i].bus ? (
                  <BusEnd lights={CARS[i].kind === 0 ? 'var(--series-4)' : 'var(--status-critical)'} />
                ) : (
                  <CarEnd color={CARS[i].color} lights={CARS[i].kind === 0 ? 'var(--series-4)' : 'var(--status-critical)'} />
                )}
              </g>
            ))}
          </g>
          <g>
            {farFirst(PEOPLE_OUT).map((i) => (
              <g key={i} ref={(el) => void (passers.current[i] = el)} opacity="0">
                {PEOPLE_OUT[i].kind === 0 ? (
                  <Walker color={PEOPLE_OUT[i].color} legs={passerLegs.current[i]} />
                ) : (
                  <Cyclist color={PEOPLE_OUT[i].color} legs={passerLegs.current[i]} />
                )}
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

          {/* Traffic lights at the junction */}
          <g ref={signalGroup} opacity="0">
            {SIGNALS.map((_, i) => (
              <g key={i} ref={(el) => void (signals.current[i] = el)} opacity="0" strokeWidth="0.04">
                <rect x="-0.07" y="-4" width="0.14" height="4" style={{ fill: TRIM }} />
                <rect x="-0.32" y="-5.05" width="0.64" height="1.62" rx="0.12" style={{ fill: MASK }} />
                {SIGNAL_LAMPS.map((color, k) => (
                  <circle
                    key={k}
                    ref={(el) => void (signalLamps.current[i][k] = el)}
                    cx="0"
                    cy={-4.78 + k * 0.52}
                    r="0.18"
                    stroke="none"
                    style={{ fill: color }}
                    opacity="0.18"
                  />
                ))}
              </g>
            ))}
          </g>

          {/* Street lamps along the inner kerb of both roads: a pole, an arm over the road, and a
              head that lights up (with a pool of glow) only in dark mode */}
          <g>
            {Array.from({ length: STREET_LAMPS }, (_, i) => (
              <g key={i} ref={(el) => void (streetLamps.current[i] = el)} opacity="0">
                {[-1, 1].map((s) => (
                  <g key={s}>
                    <path
                      d={`M${s * STREET_LAMP_X} ${EYE - GROUND_Y}V${EYE + 0.5}L${s * (STREET_LAMP_X + 1.5)} ${EYE + 0.7}`}
                      fill="none"
                      strokeWidth="0.1"
                      strokeLinecap="round"
                      style={{ stroke: TRIM }}
                    />
                    <rect x={s * (STREET_LAMP_X + 1.5) - 0.3} y={EYE + 0.62} width="0.6" height="0.18" rx="0.08" stroke="none" style={{ fill: MASK }} />
                    <g style={{ opacity: 'var(--car-lights, 0)' }}>
                      <circle cx={s * (STREET_LAMP_X + 1.5)} cy={EYE + 0.85} r="0.9" style={{ fill: STREET_GLOW }} opacity="0.18" stroke="none" />
                      <rect x={s * (STREET_LAMP_X + 1.5) - 0.24} y={EYE + 0.78} width="0.48" height="0.08" stroke="none" style={{ fill: STREET_GLOW }} />
                    </g>
                  </g>
                ))}
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
                <rect x="-1.1" y="-1.3" width="2.2" height="0.7" rx="0.08" strokeWidth="0.05" style={{ fill: 'var(--series-1)' }} />
                <text
                  x="0"
                  y="-0.8"
                  textAnchor="middle"
                  fontSize="0.4"
                  fontWeight="800"
                  letterSpacing="0.06"
                  stroke="none"
                  style={{ fill: 'var(--page-plane)', fontFamily: "'Exo 2', Inter, sans-serif" }}
                >
                  NEBULA
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
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}

/** A car seen end-on, in metres: headlights toward us, or tail lights going away, lit only in dark mode. */
function CarEnd({ color, lights }: { color: string; lights: string }) {
  return (
    <g strokeWidth="0.04">
      <path d="M-0.72 -0.95 L-0.55 -1.45 L0.55 -1.45 L0.72 -0.95 Z" style={{ fill: GLASS }} />
      <rect x="-0.9" y="-0.98" width="1.8" height="0.7" rx="0.16" style={{ fill: color }} />
      <rect x="-0.8" y="-0.3" width="0.3" height="0.3" stroke="none" style={{ fill: TYRE }} />
      <rect x="0.5" y="-0.3" width="0.3" height="0.3" stroke="none" style={{ fill: TYRE }} />
      {[-0.63, 0.63].map((cx) => (
        <Lamp key={cx} cx={cx} cy={-0.77} lights={lights} />
      ))}
    </g>
  )
}

/** A road lamp: a dim housing, lit (with a glow) only in dark mode, where --car-lights is 1. */
function Lamp({ cx, cy, lights }: { cx: number; cy: number; lights: string }) {
  return (
    <g stroke="none">
      <rect x={cx - 0.15} y={cy - 0.07} width="0.3" height="0.14" rx="0.05" style={{ fill: `color-mix(in srgb, ${lights} 30%, ${GLASS})` }} />
      <g style={{ opacity: 'var(--car-lights, 0)' }}>
        <circle cx={cx} cy={cy} r="0.34" style={{ fill: lights }} opacity="0.3" />
        <rect x={cx - 0.15} y={cy - 0.07} width="0.3" height="0.14" rx="0.05" style={{ fill: lights }} />
      </g>
    </g>
  )
}

/** A single-deck bus seen end-on, in metres: tall body, wide windscreen, a destination display. */
function BusEnd({ lights }: { lights: string }) {
  return (
    <g strokeWidth="0.04">
      <rect x="-1.25" y="-3.1" width="2.5" height="2.85" rx="0.25" style={{ fill: 'var(--series-3)' }} />
      <rect x="-1.08" y="-2.72" width="2.16" height="1.35" rx="0.12" style={{ fill: GLASS }} />
      <rect x="-0.8" y="-3.0" width="1.6" height="0.2" rx="0.04" stroke="none" style={{ fill: 'var(--series-4)' }} opacity="0.85" />
      <rect x="-1.1" y="-0.3" width="0.36" height="0.3" stroke="none" style={{ fill: TYRE }} />
      <rect x="0.74" y="-0.3" width="0.36" height="0.3" stroke="none" style={{ fill: TYRE }} />
      {[-0.9, 0.9].map((cx) => (
        <Lamp key={cx} cx={cx} cy={-0.62} lights={lights} />
      ))}
    </g>
  )
}

/** Someone walking, in metres, seen from ahead or behind. `legs` collects the two leg lines, whose feet the loop lifts in turn. */
function Walker({ color, legs }: { color: string; legs: (SVGLineElement | null)[] }) {
  return (
    <g stroke="none">
      {[-1, 1].map((s, k) => (
        <line
          key={s}
          ref={(el) => void (legs[k] = el)}
          x1={s * 0.1}
          y1="0"
          x2={s * 0.05}
          y2="-0.85"
          strokeWidth="0.13"
          strokeLinecap="round"
          style={{ stroke: color }}
        />
      ))}
      <rect x="-0.23" y="-1.45" width="0.46" height="0.68" rx="0.16" style={{ fill: color }} />
      <circle cx="0" cy="-1.63" r="0.15" style={{ fill: tint(65) }} />
    </g>
  )
}

/**
 * A cyclist, in metres, seen from ahead or behind: the front wheel edge-on with its fork,
 * drop of handlebars with grips, the rider leaning in with arms to the bars and a helmet,
 * and two legs whose feet the loop moves round the pedals.
 */
function Cyclist({ color, legs }: { color: string; legs: (SVGLineElement | null)[] }) {
  return (
    <g strokeLinecap="round">
      {/* Wheel: a narrow tyre, taller than it is wide, and the hub */}
      <ellipse cx="0" cy="-0.35" rx="0.07" ry="0.35" strokeWidth="0.03" style={{ fill: TYRE }} />
      {/* Fork up to the stem, and the bars with dark grips */}
      <path d="M-0.06 -0.35V-0.95M0.06 -0.35V-0.95M0 -0.95V-1.05" strokeWidth="0.04" fill="none" style={{ stroke: TRIM }} />
      <line x1="-0.34" y1="-1.05" x2="0.34" y2="-1.05" strokeWidth="0.05" style={{ stroke: TRIM }} />
      <line x1="-0.36" y1="-1.05" x2="-0.27" y2="-1.05" strokeWidth="0.08" style={{ stroke: TYRE }} />
      <line x1="0.27" y1="-1.05" x2="0.36" y2="-1.05" strokeWidth="0.08" style={{ stroke: TYRE }} />
      <g stroke="none">
        {/* Legs from the hips down to the pedals either side of the wheel */}
        {[-1, 1].map((s, k) => (
          <line
            key={s}
            ref={(el) => void (legs[k] = el)}
            x1={s * 0.2}
            y1="-0.45"
            x2={s * 0.1}
            y2="-1.15"
            strokeWidth="0.12"
            style={{ stroke: 'color-mix(in srgb, #1f2833 70%, var(--page-plane))' }}
          />
        ))}
        {/* Arms out to the grips, the torso leaning over, a head and a helmet */}
        <line x1="-0.17" y1="-1.55" x2="-0.31" y2="-1.08" strokeWidth="0.09" style={{ stroke: color }} />
        <line x1="0.17" y1="-1.55" x2="0.31" y2="-1.08" strokeWidth="0.09" style={{ stroke: color }} />
        <rect x="-0.21" y="-1.68" width="0.42" height="0.58" rx="0.15" style={{ fill: color }} />
        <circle cx="0" cy="-1.83" r="0.13" style={{ fill: tint(65) }} />
        <path d="M-0.16 -1.85A0.16 0.16 0 0 1 0.16 -1.85Z" style={{ fill: 'var(--series-4)' }} />
      </g>
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
