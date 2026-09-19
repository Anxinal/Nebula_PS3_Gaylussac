/** The four PS3 subsystems, keyed by the slug used in routes, APIs and filenames. */
export type SubsystemId = 'door' | 'acv' | 'rail' | 'shm'

/** Where a prediction came from. Surfaced in the UI so results are never ambiguous. */
export type EngineId = 'backend' | 'baseline'

/** One decision rule the tree ensemble applied, in plain words and as the exact split. */
export interface ExplanationNode {
  plain: string
  rule: string
  /** How far this rule moved the prediction; the signs add up to the final value. */
  contribution: number
  /** How many trees in the forest applied it. */
  nTrees?: number
}

/** Why the trained model decided what it did. Only the model backend supplies these. */
export interface Explanation {
  plainSummary: string
  reasons: string[]
  topNodes: ExplanationNode[]
  /** What the explained value is, when it is not obvious (e.g. which cycle it covers). */
  note?: string
}

export interface DoorSegment {
  /** Native dataset timestamp, e.g. "2023-7-5-0-11-17-664". */
  startTime: string
  endTime: string
  prediction: 'Normal' | 'Abnormal resistance'
  /** Informational only — PS3 does not score the operation. */
  operation?: 'Open' | 'Close'
  /** Mean motor current over the cycle (mA); the baseline's decision variable. */
  meanCurrent?: number
  /** Signed distance from the decision threshold, normalised: >0 means abnormal. */
  margin?: number
  rowCount?: number
  /** Seconds from the start of the stream, for timeline placement. */
  startOffsetSec?: number
  endOffsetSec?: number
  explanation?: Explanation
}

export interface DoorResult {
  kind: 'door'
  segments: DoorSegment[]
  /** Downsampled motor-current trace of the whole stream, for the overview chart. */
  trace: { t: number; current: number }[]
  totalRows: number
  durationSec: number
  /** One-line verdict for the whole stream, from the backend. */
  summary?: string
  /** The explanation behind the most telling cycle, from the backend. */
  explanation?: Explanation
}

export interface AcvCarScore {
  /** Car identifier exactly as it appears in the file's own headers, e.g. "03". */
  car: string
  score: number
  rank: number
  /** Human-readable reason this car scored where it did. */
  evidence: string
}

export interface AcvFileResult {
  fileId: string
  cars: AcvCarScore[]
  /** Per-car mean indoor temperature series, for the comparison chart. */
  series: { car: string; points: { t: number; value: number }[] }[]
  sampleCount: number
  explanation?: Explanation
}

export interface AcvResult {
  kind: 'acv'
  files: AcvFileResult[]
}

export type RailLabel = 'Normal' | 'Side I' | 'Side II'

export interface RailFileResult {
  fileId: string
  prediction: RailLabel
  confidence: number
  /** Side-level diagnostics that explain the call. */
  sideI: number
  sideII: number
  rowCount: number
  speedKmh: number | null
  explanation?: Explanation
}

export interface RailResult {
  kind: 'rail'
  files: RailFileResult[]
}

export interface ShmFileResult {
  fileId: string
  prediction: number
  /** Rainflow cycle count behind the estimate. */
  cycles: number
  /** Largest stress range seen in the file (same units as the input). */
  maxRange: number
  /** Per-bin damage contribution, for the contribution chart. */
  bins: { rangeMid: number; cycles: number; damage: number }[]
  explanation?: Explanation
}

export interface ShmResult {
  kind: 'shm'
  files: ShmFileResult[]
}

export type SubsystemResult = DoorResult | AcvResult | RailResult | ShmResult

export interface RunRecord {
  subsystem: SubsystemId
  engine: EngineId
  /** Short label for the engine, e.g. "Rule baseline v1" or "backend @ /api". */
  engineLabel: string
  result: SubsystemResult
  inputFiles: string[]
  finishedAt: number
  /** The submission CSV exactly as PS3 specifies it. */
  csv: { filename: string; content: string }
  warnings: string[]
}

export interface ParsedFile {
  name: string
  size: number
  /** Raw text for CSV inputs; an ArrayBuffer for .xlsx. */
  text?: string
  buffer?: ArrayBuffer
}
