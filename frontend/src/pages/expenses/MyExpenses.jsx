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
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Returned', value: 'RETURNED' },
  { label: 'Rejected', value: 'REJECTED' },
]

const currentYear = new Date().getFullYear()

export default function MyExpenses() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const isPrivileged = user?.roleType === 'SUPER_ADMIN' || can('APPROVE_EXPENSE') || can('VERIFY_EXPENSE')
  const [scope, setScope] = useState(isPrivileged ? 'all' : 'mine')
  const [statusFilter, setStatusFilter] = useState('')
  const [allRows, setAllRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewingClaimId, setViewingClaimId] = useState(null)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const { rows } = await expensesApi.listClaims({
        status: statusFilter || undefined,
        pageSize: 100,
      })
      if (scope === 'mine') {
        setAllRows(rows.filter((row) => row.employeeId === user?.employee?.id))
      } else {
        setAllRows(rows)
      }
    } catch (err) {
      setError(unwrapError(err, 'Could not load expenses.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, scope])

  const { pendingCount, approvedTotal, reimbursedTotal } = computeExpenseStats(allRows)

  const columns = [
    ...(scope === 'all'
      ? [
          {
            key: 'employee',
            label: 'Employee',
            render: (row) =>
              row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : '—',
          },
        ]
      : []),
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
      title={isPrivileged && scope === 'all' ? 'Expense Management' : 'My Expenses'}
      subtitle={
        isPrivileged && scope === 'all'
          ? 'Manage and monitor all expense claims across the organization.'
          : 'Your submitted expense claims and their approval status.'
      }
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
        {isPrivileged && (
          <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => setScope('all')}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors"
              style={{
                background: scope === 'all' ? 'var(--accent)' : 'var(--surface-muted, #f1f5f9)',
                color: scope === 'all' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              {user?.roleType === 'SUPER_ADMIN' || can('VERIFY_EXPENSE') ? 'All Claims (Admin)' : 'Team Claims'}
            </button>
            <button
              type="button"
              onClick={() => setScope('mine')}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors"
              style={{
                background: scope === 'mine' ? 'var(--accent)' : 'var(--surface-muted, #f1f5f9)',
                color: scope === 'mine' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              My Claims Only
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Pending Claims" value={String(pendingCount)} sublabel="Awaiting a decision" sublabelColor="warning" />
          <StatCard
            label="Approved Claims"
            value={formatCurrency(approvedTotal)}
            sublabel={`${currentYear}`}
            sublabelColor="success"
          />
          <StatCard
            label="Paid Expenses"
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
            No expense claims found.
          </p>
        ) : (
          <DataTable columns={columns} rows={allRows} />
        )}
      </div>

      {viewingClaimId && <ClaimDetailModal claimId={viewingClaimId} onClose={() => setViewingClaimId(null)} />}
    </AppShell>
  )
}
