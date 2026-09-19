import type { SubsystemId } from './types'

export interface SubsystemMeta {
  id: SubsystemId
  name: string
  /** A few words on the card — the short version. */
  tagline: string
  /** The long version, revealed from the card's info icon. */
  detail: string
  task: string
  signal: string
  /** The PS3 scoring metric for this subsystem. */
  metric: string
  outputFile: string
  /** What the user should drop in, in plain words. */
  expects: string
  accept: string
  multiple: boolean
  /** Extensions accepted, lowercase and dot-prefixed. */
  extensions: string[]
}

export const SUBSYSTEMS: Record<SubsystemId, SubsystemMeta> = {
  door: {
    id: 'door',
    name: 'Door Fault',
    tagline: 'Finds abnormal door resistance',
    detail:
      'Door controllers stream continuously, with no marks where one open/close cycle ends and the next begins. The model locates every cycle in that stream, then decides whether the motor met abnormal resistance — a jammed rubber strip, debris in the slide rail, a deformed leaf. Scored on IoU-weighted F1, so both the timing and the label have to be right.',
    task: 'Temporal segment detection + binary classification',
    signal: 'Motor current / voltage / back-EMF + door position',
    metric: 'IoU-weighted F1',
    outputFile: 'door_predictions.csv',
    // The backend scores every uploaded stream and merges their cycles into one result, so more than
    // one file is fine — e.g. several days' worth of Door Test.csv, or streams from different doors.
    expects: 'One or more continuous streams — e.g. Door Test.csv.',
    accept: '.csv',
    multiple: true,
    extensions: ['.csv'],
  },
  acv: {
    id: 'acv',
    name: 'Air Conditioning and Ventilation (ACV)',
    tagline: 'Finds the car losing refrigerant',
    detail:
      'Refrigerant leaks cause about 40% of air-conditioning faults, and a leaking car cools less well than its neighbours. Every car on the train is ranked from most to least likely to be the leaking one. Scored on a linear rank-decay score, so putting the true car second or third still earns solid credit.',
    task: 'Fault localisation / ranking',
    signal: 'Cabin + ambient temperature and control-mode telemetry',
    metric: 'Linear rank-decay score',
    outputFile: 'acv_predictions.csv',
    expects: 'One case file per train — .xlsx or .csv, several at a time.',
    accept: '.xlsx,.csv',
    multiple: true,
    extensions: ['.xlsx', '.csv'],
  },
  rail: {
    id: 'rail',
    name: 'Rail Corrugation',
    tagline: 'Analyse possible deteriorating conditions',
    detail:
      'Corrugation is a periodic wavy wear pattern on the railhead that drives up noise, dynamic forces and maintenance cost. Axle-box accelerometers pick up its signature as the train passes. Each 1-second recording is called Normal, Side I or Side II. Scored on macro F1, so rare faults count as much as the common Normal case.',
    task: 'Multi-class classification',
    signal: '64 axle-box vibration + shock channels at 10 kHz',
    metric: 'Macro F1',
    outputFile: 'rail_predictions.csv',
    expects: 'One .csv per recording — drop the whole Test folder.',
    accept: '.csv',
    multiple: true,
    extensions: ['.csv'],
  },
  shm: {
    id: 'shm',
    name: 'Structural Health Monitoring (SHM)',
    tagline: 'Estimates accumulated fatigue damage',
    detail:
      'Load-bearing structures accumulate fatigue over years of service. From a dynamic stress time series the model estimates cumulative damage, where D = 1 is Miner\'s failure threshold. Scored on max(0, 1 − MAPE), measured relative to each file\'s true value.',
    task: 'Regression',
    signal: 'Dynamic stress time series per measurement point',
    metric: 'max(0, 1 − MAPE)',
    outputFile: 'shm_predictions.csv',
    expects: 'One .csv per segment — drop the whole Test folder.',
    accept: '.csv',
    multiple: true,
    extensions: ['.csv'],
  },
}

export const SUBSYSTEM_ORDER: SubsystemId[] = ['door', 'acv', 'rail', 'shm']
