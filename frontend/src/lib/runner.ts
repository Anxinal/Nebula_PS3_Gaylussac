import { readAsArrayBuffer, readAsText } from './csv'
import { predictViaBackend } from './api'
import { checkHead } from './validate'
import { buildPredictionCsv } from './predictionCsv'
import { DOOR_BASELINE_LABEL, runDoorBaseline } from './engines/door'
import { ACV_BASELINE_LABEL, runAcvBaseline } from './engines/acv'
import { RAIL_BASELINE_LABEL, classifyRailBatch, extractRailFeatures } from './engines/rail'
import {
  SHM_BASELINE_LABEL,
  calibrate,
  extractShmFeatures,
  looksLikeLabelsFile,
  parseShmLabels,
  predictShm,
  type ShmCalibration,
} from './engines/shm'
import type {
  AcvFileResult,
  EngineId,
  RunRecord,
  SubsystemId,
  SubsystemResult,
} from '../types'

export interface RunProgress {
  done: number
  total: number
  label: string
}

export interface RunOptions {
  apiBase: string
  useBackend: boolean
  shmCalibration: ShmCalibration
  onProgress?: (p: RunProgress) => void
  /** Called when a run fits a new SHM calibration, so it can be persisted. */
  onCalibrated?: (c: ShmCalibration) => void
}

/** Let the browser paint between files so progress is visible and input stays live. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function runSubsystem(
  subsystem: SubsystemId,
  files: File[],
  opts: RunOptions,
): Promise<RunRecord> {
  if (files.length === 0) throw new Error('Add at least one file first.')

  // Validate before doing any real work: reading the first slice of each file is
  // fast, so a wrong file is reported now rather than after a long parse.
  opts.onProgress?.({ done: 0, total: files.length, label: 'Checking files…' })
  const problems: string[] = []
  for (const file of files) {
    const problem = await checkHead(subsystem, file)
    if (problem) problems.push(problem)
  }
  if (problems.length > 0) {
    throw new Error(
      problems.length === 1
        ? problems[0]
        : `${problems.length} files could not be read:\n· ${problems.slice(0, 3).join('\n· ')}` +
          (problems.length > 3 ? `\n· …and ${problems.length - 3} more` : ''),
    )
  }

  const warnings: string[] = []
  let engine: EngineId = 'baseline'
  let engineLabel = ''
  let result: SubsystemResult

  if (opts.useBackend && opts.apiBase) {
    opts.onProgress?.({ done: 0, total: 1, label: 'Sending files to the model backend…' })
    result = await predictViaBackend(opts.apiBase, subsystem, files)
    engine = 'backend'
    engineLabel = `Model backend (${opts.apiBase})`
  } else if (subsystem === 'shm') {
    // No in-browser stand-in for damage: without the trained model there is nothing honest to show.
    throw new Error(
      'Structural Health Monitoring is scored only by the trained model. Start the backend (python serve.py in backend/) and retry.',
    )
  } else {
    const run = await runBaseline(subsystem, files, opts, warnings)
    result = run.result
    engineLabel = run.label
  }

  return {
    subsystem,
    engine,
    engineLabel,
    result,
    inputFiles: files.map((f) => f.name),
    finishedAt: Date.now(),
    csv: buildPredictionCsv(subsystem, result),
    warnings,
  }
}

async function runBaseline(
  subsystem: SubsystemId,
  files: File[],
  opts: RunOptions,
  warnings: string[],
): Promise<{ result: SubsystemResult; label: string }> {
  switch (subsystem) {
    case 'door': {
      if (files.length > 1) {
        warnings.push(
          `Door Test is one continuous stream — used "${files[0].name}" and ignored ${files.length - 1} other file(s).`,
        )
      }
      opts.onProgress?.({ done: 0, total: 1, label: `Reading ${files[0].name}…` })
      const text = await readAsText(files[0])
      opts.onProgress?.({ done: 0, total: 1, label: 'Finding door cycles…' })
      await yieldToUi()
      const { result, warnings: w } = runDoorBaseline(text)
      warnings.push(...w)
      opts.onProgress?.({ done: 1, total: 1, label: 'Done' })
      return { result, label: DOOR_BASELINE_LABEL }
    }

    case 'acv': {
      const out: AcvFileResult[] = []
      for (let i = 0; i < files.length; i++) {
        opts.onProgress?.({ done: i, total: files.length, label: `Reading ${files[i].name}…` })
        await yieldToUi()
        const buffer = await readAsArrayBuffer(files[i])
        const { result, warnings: w } = await runAcvBaseline(files[i].name, buffer)
        warnings.push(...w)
        out.push(result)
      }
      opts.onProgress?.({ done: files.length, total: files.length, label: 'Done' })
      return { result: { kind: 'acv', files: out }, label: ACV_BASELINE_LABEL }
    }

    case 'rail': {
      const features = []
      for (let i = 0; i < files.length; i++) {
        opts.onProgress?.({
          done: i,
          total: files.length,
          label: `Measuring axle-box energy — ${files[i].name} (${i + 1}/${files.length})`,
        })
        await yieldToUi()
        const text = await readAsText(files[i])
        features.push(extractRailFeatures(files[i].name, text))
      }
      if (features.length < 5) {
        warnings.push(
          'The Normal/faulty threshold is derived from the batch, so accuracy improves markedly with the whole test folder dropped in at once rather than a few files.',
        )
      }
      const predictions = classifyRailBatch(features)
      opts.onProgress?.({ done: files.length, total: files.length, label: 'Done' })
      return { result: { kind: 'rail', files: predictions }, label: RAIL_BASELINE_LABEL }
    }

    case 'shm': {
      const labelFiles = files.filter((f) => looksLikeLabelsFile(f.name))
      const dataFiles = files.filter((f) => !looksLikeLabelsFile(f.name))
      if (dataFiles.length === 0) throw new Error('Add the stress data files, not just the labels file.')

      const features = []
      for (let i = 0; i < dataFiles.length; i++) {
        opts.onProgress?.({
          done: i,
          total: dataFiles.length,
          label: `Rainflow counting — ${dataFiles[i].name} (${i + 1}/${dataFiles.length})`,
        })
        await yieldToUi()
        const text = await readAsText(dataFiles[i])
        features.push(extractShmFeatures(dataFiles[i].name, text))
      }

      let cal = opts.shmCalibration
      if (labelFiles.length > 0) {
        opts.onProgress?.({
          done: dataFiles.length,
          total: dataFiles.length,
          label: 'Fitting the S-N curve to your labels…',
        })
        await yieldToUi()
        const labels = parseShmLabels(await readAsText(labelFiles[0]))
        const fitted = calibrate(features, labels)
        if (fitted) {
          cal = fitted
          opts.onCalibrated?.(fitted)
          warnings.push(
            `Calibrated on ${fitted.fileCount} labelled file(s): m = ${fitted.m.toFixed(2)}, ` +
              `training MAPE ${(fitted.mape * 100).toFixed(1)}% (score ${Math.max(0, 1 - fitted.mape).toFixed(3)}). ` +
              'This calibration is saved and reused on your test files.',
          )
        } else {
          warnings.push(
            `Could not fit a calibration from ${labelFiles[0].name} — no file names matched the uploaded data files.`,
          )
        }
      } else if (!cal.fittedAt) {
        warnings.push(
          'No calibration yet: these values use default S-N constants and are a relative damage index, not damage in the units PS3 scores. ' +
            'Drop the Train folder together with Train_Labels.csv once to calibrate.',
        )
      }

      const out = features.map((f) => predictShm(f, cal))
      opts.onProgress?.({ done: dataFiles.length, total: dataFiles.length, label: 'Done' })
      return { result: { kind: 'shm', files: out }, label: `${SHM_BASELINE_LABEL} (m = ${cal.m.toFixed(2)})` }
    }
  }
}
