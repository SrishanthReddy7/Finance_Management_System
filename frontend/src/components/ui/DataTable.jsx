/**
 * columns: Array<{ key, label, align?: 'left'|'right'|'center', render?: (row) => ReactNode }>
 */
export default function DataTable({
  columns,
  rows,
  onRowClick,
  page,
  pageSize,
  totalCount,
  onPageChange,
}) {
  const showPagination = page != null && pageSize != null && totalCount != null

  const from = showPagination ? (totalCount === 0 ? 0 : (page - 1) * pageSize + 1) : null
  const to = showPagination ? Math.min(page * pageSize, totalCount) : null

  return (
    <div className="dt-wrap overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <table className="dt w-full border-collapse text-left">
        <thead>
          <tr style={{ background: '#FAFAFC' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
                style={{
                  color: 'var(--ink-muted)',
                  textAlign: col.align || 'left',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.id ?? idx}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer transition-colors hover:bg-[--bg]' : ''}
              style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border)' }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-4 py-3 text-[13px]"
                  style={{ color: 'var(--ink)', textAlign: col.align || 'left' }}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {showPagination && (
        <div
          className="flex items-center justify-between px-4 py-3 text-[12px]"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--ink-muted)' }}
        >
          <span className="num">
            Showing {from}–{to} of {totalCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
              className="rounded-md border px-3 py-1 font-medium disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page * pageSize >= totalCount}
              onClick={() => onPageChange?.(page + 1)}
              className="rounded-md border px-3 py-1 font-medium disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
