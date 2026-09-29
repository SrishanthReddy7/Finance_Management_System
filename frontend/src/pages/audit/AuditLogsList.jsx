import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as auditApi from '../../api/audit'
import { unwrapError } from '../../api/unwrap'
import { formatDate } from '../../utils/format'

const PAGE_SIZE = 30

export default function AuditLogsList() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    auditApi
      .listAuditLogs({ entityType: entityType || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        if (cancelled) return
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load audit logs.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityType, page])

  const columns = [
    { key: 'createdAt', label: 'When', render: (row) => formatDate(row.createdAt) },
    { key: 'entityType', label: 'Entity' },
    { key: 'action', label: 'Action' },
    { key: 'performedBy', label: 'By', render: (row) => row.performedBy?.email || '—' },
    { key: 'note', label: 'Note', render: (row) => row.note || '—' },
  ]

  return (
    <AppShell navItems={navItems} title="Audit Logs" subtitle="A record of who changed what, and when.">
      <div className="flex flex-col gap-5">
        <input
          type="text"
          value={entityType}
          onChange={(e) => {
            setPage(1)
            setEntityType(e.target.value)
          }}
          placeholder="Filter by entity type (e.g. VendorBill, Invoice)…"
          className="w-80 rounded-lg border px-3 py-2 text-[13px]"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        />

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            No audit log entries found.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            page={meta?.page}
            pageSize={meta?.pageSize}
            totalCount={meta?.totalCount}
            onPageChange={setPage}
          />
        )}
      </div>
    </AppShell>
  )
}
