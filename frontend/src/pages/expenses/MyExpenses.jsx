import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import StatCard from '../../components/ui/StatCard'
import StatusBadge from '../../components/ui/StatusBadge'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import { computeExpenseStats } from '../../utils/expenseStats'
import ClaimDetailModal from './ClaimDetailModal'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Manager Approved', value: 'MANAGER_APPROVED' },
  { label: 'Finance Approved', value: 'FINANCE_APPROVED' },
  { label: 'Returned', value: 'RETURNED' },
  { label: 'Paid', value: 'PAID' },
]

const currentYear = new Date().getFullYear()

export default function MyExpenses() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [allRows, setAllRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewingClaimId, setViewingClaimId] = useState(null)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      // No `mine=true` query param exists server-side -- the list is scoped
      // by role (own / reviewable team / company-wide) and filtered down to
      // this employee's own claims here. pageSize is generously large since
      // there's no dedicated "my claims" endpoint to paginate against yet.
      const { rows } = await expensesApi.listClaims({
        status: statusFilter || undefined,
        pageSize: 100,
      })
      setAllRows(rows.filter((row) => row.employeeId === user?.employee?.id))
    } catch (err) {
      setError(unwrapError(err, 'Could not load your expenses.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const { pendingCount, approvedTotal, reimbursedTotal } = computeExpenseStats(allRows)

  const columns = [
    { key: 'purpose', label: 'Purpose' },
    { key: 'category', label: 'Category', render: (row) => row.category?.name || '—' },
    { key: 'expenseDate', label: 'Date', render: (row) => formatDate(row.expenseDate) },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (row) => <span className="num">{formatCurrency(row.amount)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} entity="expense" />,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setViewingClaimId(row.id)}
            className="text-[12px] font-medium"
            style={{ color: 'var(--accent)' }}
          >
            View
          </button>
          {row.status === 'RETURNED' && (
            <Link to={`/expenses/${row.id}/edit`} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
              Resubmit
            </Link>
          )}
        </div>
      ),
    },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="My Expenses"

      subtitle="Your submitted expense claims and their approval status."
      topbarActions={
        <Link
          to="/expenses/new"
          className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          Submit New Expense
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Pending Claims" value={String(pendingCount)} sublabel="Awaiting a decision" sublabelColor="warning" />
          <StatCard
            label="Approved This Year"
            value={formatCurrency(approvedTotal)}
            sublabel={`${currentYear}`}
            sublabelColor="success"
          />
          <StatCard
            label="Reimbursed This Year"
            value={formatCurrency(reimbursedTotal)}
            sublabel={`${currentYear}`}
            sublabelColor="muted"
          />
        </div>

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
        ) : allRows.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            No expense claims yet.
          </p>
        ) : (
          <DataTable columns={columns} rows={allRows} />
        )}
      </div>

      {viewingClaimId && <ClaimDetailModal claimId={viewingClaimId} onClose={() => setViewingClaimId(null)} />}
    </AppShell>
  )
}
