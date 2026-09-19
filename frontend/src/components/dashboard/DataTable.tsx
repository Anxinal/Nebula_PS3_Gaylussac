import type { ReactNode } from 'react'

export interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
}

/** A plain scrolling table for a detail page: the rows behind the chart above it. */
export function DataTable({ columns, rows }: { columns: Column[]; rows: Record<string, ReactNode>[] }) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-left text-[0.72rem]">
        <thead className="sticky top-0 bg-surface text-ink-secondary">
          <tr className="border-b border-hairline">
            {columns.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`tnum whitespace-nowrap px-3 py-2 text-ink-secondary ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
