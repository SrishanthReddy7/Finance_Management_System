import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as vendorBillsApi from '../../api/vendorBills'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Pending Verification', value: 'PENDING_VERIFICATION' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Pending Approval', value: 'PENDING_APPROVAL' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Partially Paid', value: 'PARTIALLY_PAID' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const PAGE_SIZE = 20

export default function VendorBillsList() {
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
    vendorBillsApi
      .listVendorBills({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        if (cancelled) return
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load vendor bills.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statusFilter, page])

  const columns = [
    { key: 'billNumber', label: 'Bill #', render: (row) => <span className="num">{row.billNumber}</span> },
    { key: 'vendor', label: 'Vendor', render: (row) => row.vendor?.name || '—' },
    { key: 'billDate', label: 'Bill Date', render: (row) => formatDate(row.billDate) },
    { key: 'dueDate', label: 'Due Date', render: (row) => formatDate(row.dueDate) },
    { key: 'totalAmount', label: 'Total', align: 'right', render: (row) => <span className="num">{formatCurrency(row.totalAmount)}</span> },
    {
      key: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      render: (row) => (
        <span className="num" style={{ color: row.ap?.isOverdue ? 'var(--danger)' : 'var(--ink)' }}>
          {formatCurrency(row.ap?.outstandingAmount)}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="vendorBill" /> },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="Vendors & Bills"

      subtitle="Verify, approve and pay vendor bills."
      topbarActions={
        can('MANAGE_VENDORS') && (
          <button
            type="button"
            onClick={() => navigate('/vendor-bills/new')}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Vendor Bill
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <PageTabs tabs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Bills', href: '/vendor-bills' }]} />

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
            No vendor bills found.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(row) => navigate(`/vendor-bills/${row.id}`)}
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
