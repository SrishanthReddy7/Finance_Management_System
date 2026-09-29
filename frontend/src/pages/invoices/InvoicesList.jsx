import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import KpiRow from '../../components/dashboard/KpiRow'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as invoicesApi from '../../api/invoices'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Pending Approval', value: 'PENDING_APPROVAL' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Sent', value: 'SENT' },
  { label: 'Partially Paid', value: 'PARTIALLY_PAID' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Overdue', value: 'OVERDUE' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const OUTSTANDING_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

export default function InvoicesList() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    invoicesApi
      .listInvoices({ status: statusFilter || undefined, pageSize: 100 })
      .then(({ rows: fetched }) => {
        if (!cancelled) setRows(fetched)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load invoices.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statusFilter])

  const outstandingTotal = rows
    .filter((r) => OUTSTANDING_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + Number(r.ar?.remainingAmount || 0), 0)
  const overdueCount = rows.filter((r) => r.ar?.isOverdue).length
  const paidTotal = rows.filter((r) => r.status === 'PAID').reduce((sum, r) => sum + Number(r.totals?.totalAmount || 0), 0)

  const tabs = [{ label: 'Invoices', href: '/invoices' }]
  if (can('VIEW_FINANCIAL_REPORTS')) tabs.push({ label: 'Client Payments', href: '/invoices/payments' })

  const columns = [
    { key: 'invoiceNumber', label: 'Invoice #', render: (row) => <span className="num">{row.invoiceNumber}</span> },
    { key: 'client', label: 'Client', render: (row) => row.client?.name || '—' },
    { key: 'invoiceDate', label: 'Date', render: (row) => formatDate(row.invoiceDate) },
    { key: 'dueDate', label: 'Due', render: (row) => formatDate(row.dueDate) },
    {
      key: 'totalAmount',
      label: 'Amount',
      align: 'right',
      render: (row) => <span className="num">{formatCurrency(row.totals?.totalAmount ?? row.totalAmount)}</span>,
    },
    {
      key: 'remaining',
      label: 'Balance',
      align: 'right',
      render: (row) => <span className="num">{formatCurrency(row.ar?.remainingAmount ?? 0)}</span>,
    },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="invoice" /> },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="Invoices & Payments"

      subtitle="Create invoices, track client payments and outstanding amounts."
      topbarActions={
        can('CREATE_INVOICE') && (
          <Link
            to="/invoices/new"
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Invoice
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <PageTabs tabs={tabs} />

        <KpiRow
          stats={[
            { label: 'Outstanding', value: formatCurrency(outstandingTotal), sublabel: 'Sent, unpaid', sublabelColor: 'warning' },
            { label: 'Overdue', value: String(overdueCount), sublabel: 'Invoices past due', sublabelColor: 'danger' },
            { label: 'Paid', value: formatCurrency(paidTotal), sublabel: 'This view', sublabelColor: 'success' },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
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
            No invoices found.
          </p>
        ) : (
          <DataTable columns={columns} rows={rows} onRowClick={(row) => navigate(`/invoices/${row.id}`)} />
        )}
      </div>
    </AppShell>
  )
}
