import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import TypeChip from '../../components/ui/TypeChip'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payoutsApi from '../../api/payouts'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Created', value: 'CREATED' },
  { label: 'Awaiting Approval', value: 'AWAITING_APPROVAL' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Queued', value: 'QUEUED' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Processed', value: 'PROCESSED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Reversed', value: 'REVERSED' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const PURPOSE_COLORS = {
  REIMBURSEMENT: 'var(--info)',
  SALARY: 'var(--accent)',
  VENDOR_PAYMENT: 'var(--warning)',
}

const PAGE_SIZE = 20

export default function PayoutsList() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    payoutsApi
      .listPayouts({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        if (cancelled) return
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load payouts.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statusFilter, page])

  const columns = [
    {
      key: 'purpose',
      label: 'Purpose',
      render: (row) => <TypeChip label={row.purpose.replace(/_/g, ' ')} color={PURPOSE_COLORS[row.purpose]} />,
    },
    { key: 'amount', label: 'Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.amount)}</span> },
    { key: 'provider', label: 'Provider', render: (row) => row.provider },
    { key: 'utr', label: 'UTR', render: (row) => <span className="num">{row.utr || '—'}</span> },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="payout" /> },
  ]

  return (
    <AppShell navItems={navItems} title="Payouts" subtitle="Track payouts through approval, processing and settlement.">
      <div className="flex flex-col gap-5">
        <p className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          Provider: Mock — payouts settle through a simulated provider until RazorpayX goes live.
        </p>

        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => {
                setPage(1)
                setStatusFilter(chip.value)
              }}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: statusFilter === chip.value ? 'var(--accent)' : 'var(--border)',
                background: statusFilter === chip.value ? 'var(--accent-soft)' : 'var(--surface)',
                color: statusFilter === chip.value ? 'var(--accent)' : 'var(--ink-muted)',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

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
            No payouts found.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(row) => navigate(`/payouts/${row.id}`)}
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
