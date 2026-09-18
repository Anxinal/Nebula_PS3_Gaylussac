import { useCallback, useRef, useState } from 'react'
import type { SubsystemMeta } from '../subsystems'
import { filterSelection, type Rejection } from '../lib/validate'
import { AlertIcon, UploadIcon } from './icons'
import { InfoHint } from './InfoHint'

/**
 * Drag & drop plus a plain file picker. Folder drops are read recursively, so a
 * user can drag the whole Test folder in rather than selecting 68 files.
 */
export function Dropzone({
  meta,
  files,
  onFiles,
}: {
  meta: SubsystemMeta
  files: File[]
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [rejected, setRejected] = useState<Rejection[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = useCallback(
    (incoming: File[]) => {
      const { accepted, rejected: bad } = filterSelection(meta, incoming)
      setRejected(bad)
      if (accepted.length === 0) return
      onFiles(meta.multiple ? dedupe([...files, ...accepted]) : [accepted[0]])
    },
    [files, meta, onFiles],
  )

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    setReading(true)
    try {
      accept(await filesFromDataTransfer(e.dataTransfer))
    } finally {
      setReading(false)
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Add data files for ${meta.name}. ${meta.expects}`}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed
                   px-6 py-10 text-center transition-colors"
        style={{
          borderColor: over ? 'var(--series-1)' : 'var(--border-hairline)',
          background: over ? 'color-mix(in srgb, var(--series-1) 7%, var(--surface-1))' : 'var(--surface-1)',
        }}
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-[1.8rem]"
          style={{
            color: 'var(--series-1)',
            background: 'color-mix(in srgb, var(--series-1) 12%, transparent)',
          }}
        >
          <UploadIcon />
        </span>
        <p className="mt-3 text-base font-semibold text-ink">
          {reading ? 'Reading folder…' : 'Drop data here, or click to choose'}
        </p>
        <p className="eyebrow mt-1.5">{meta.extensions.join(' · ')}</p>
        <input
          ref={inputRef}
          type="file"
          accept={meta.accept}
          multiple={meta.multiple}
          className="hidden"
          onChange={(e) => {
            accept(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>

      {rejected.length > 0 && (
        <div
          className="mt-3 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
          }}
        >
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <span className="text-sm" style={{ color: 'var(--status-warning)' }}>
              <AlertIcon />
            </span>
            {rejected.length} file{rejected.length === 1 ? '' : 's'} skipped
          </p>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {rejected.slice(0, 5).map((r) => (
              <li key={r.name} className="truncate">
                {r.name} — {r.reason}
              </li>
            ))}
            {rejected.length > 5 && <li>…and {rejected.length - 5} more</li>}
          </ul>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm text-ink-secondary">
              <strong className="text-ink">{files.length}</strong> file{files.length === 1 ? '' : 's'} ready
              <span className="text-ink-muted">· {formatBytes(files.reduce((a, f) => a + f.size, 0))}</span>
              <InfoHint label="About these files">
                {meta.expects} Folder drops are expanded automatically, and anything that is not{' '}
                {meta.extensions.join(' or ')} is skipped with a reason.
              </InfoHint>
            </p>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-xs"
              onClick={() => {
                onFiles([])
                setRejected([])
              }}
            >
              Clear
            </button>
          </div>
          <ul className="mt-2 max-h-40 overflow-auto rounded-lg border border-hairline">
            {files.map((f, i) => (
              <li
                key={f.name + i}
                className="flex items-center justify-between border-b border-hairline px-3 py-1.5 text-xs last:border-0"
              >
                <span className="truncate text-ink-secondary">{f.name}</span>
                <button
                  type="button"
                  className="ml-3 shrink-0 text-ink-muted hover:text-ink"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onFiles(files.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function dedupe(files: File[]): File[] {
  const seen = new Set<string>()
  return files.filter((f) => {
    const key = `${f.name}:${f.size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Expand dropped directories; browsers only give a flat list otherwise. */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[]

  if (entries.length === 0) return Array.from(dt.files)

  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      out.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries returns at most 100 at a time, so keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        )
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  await Promise.all(entries.map(walk))
  return out
}
