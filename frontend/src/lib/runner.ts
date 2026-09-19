import { predictViaBackend } from './api'
import { checkHead } from './validate'
import { buildPredictionCsv } from './predictionCsv'
import type { RunRecord, SubsystemId } from '../types'

/*
 * Runs one subsystem. Every figure the app shows comes from the trained models on
 * the backend: the browser only checks the files look right, sends them, and builds
 * the submission CSV from the backend's answer. There is no in-browser estimate.
 */

export interface RunProgress {
  done: number
  total: number
  label: string
}

export interface RunOptions {
  apiBase: string
  /** Whether the backend is reachable and has a model for this subsystem. */
  useBackend: boolean
  onProgress?: (p: RunProgress) => void
}

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

  if (!opts.useBackend || !opts.apiBase) {
    throw new Error('The trained models are not reachable. Start the backend (python serve.py in backend/) and retry.')
  }
  opts.onProgress?.({ done: 0, total: 1, label: 'Sending files to the trained models…' })
  const result = await predictViaBackend(opts.apiBase, subsystem, files)
  opts.onProgress?.({ done: 1, total: 1, label: 'Results in' })

  return {
    subsystem,
    engine: 'backend',
    engineLabel: 'Trained model',
    result,
    inputFiles: files.map((f) => f.name),
    finishedAt: Date.now(),
    csv: buildPredictionCsv(subsystem, result),
    warnings: [],
  }
}
