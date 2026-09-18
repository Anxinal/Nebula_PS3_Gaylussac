import JSZip from 'jszip'
import type { RunRecord } from '../types'

/**
 * Package the finished runs into predictions.zip exactly as PS3 requires:
 * the *_predictions.csv files at the top level of the archive, no subfolders,
 * nothing else inside.
 */
export async function buildPredictionsZip(runs: RunRecord[]): Promise<Blob> {
  const zip = new JSZip()
  for (const run of runs) zip.file(run.csv.filename, run.csv.content)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
