/*
 * Colour coding for values the backend returns. Nothing here computes data; it
 * only decides what colour a number is drawn in.
 *
 * `ramp` runs green → yellow → orange → red as t goes 0 → 1. Damage D is placed
 * on it with a log scale from 0.01 to 1 (Miner's failure threshold), because real
 * values span two orders of magnitude; D ≥ 1 gets a deeper red of its own.
 */
export const ramp = (t: number) => `oklch(${0.74 - 0.12 * t} ${0.13 + 0.07 * t} ${155 - 130 * t})`

const D_FLOOR = 0.01
const damagePosition = (d: number) =>
  Math.min(1, Math.max(0, Math.log10(Math.max(d, D_FLOOR) / D_FLOOR) / Math.log10(1 / D_FLOOR)))

export const damageColor = (d: number) => (d >= 1 ? 'oklch(0.55 0.2 20)' : ramp(damagePosition(d)))

/** A probability 0..1 on the same ramp: low is green, high is red. */
export const probabilityColor = (p: number) => ramp(Math.min(1, Math.max(0, p)))
