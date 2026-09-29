import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import ProgressBar from '../../components/ui/ProgressBar'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as budgetsApi from '../../api/budgets'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
import BudgetFormModal from './BudgetFormModal'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Closed', value: 'CLOSED' },
]

const PAGE_SIZE = 20

export default function BudgetsList() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    budgetsApi
      .listBudgets({ status: statusFilter || undefined, pageSize: PAGE_SIZE })
      .then(async ({ rows: fetched }) => {
        const withUtilization = await Promise.all(
          fetched.map((b) =>
            budgetsApi
              .getUtilization(b.id)
              .then((u) => ({ ...b, ...u }))
              .catch(() => b)
          )
        )
        setRows(withUtilization)
      })
      .catch((err) => setError(unwrapError(err, 'Could not load budgets.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  return (
    <AppShell
      navItems={navItems}
      title="Budgets"

      subtitle="Plan budgets and monitor utilization."
      topbarActions={
        can('MANAGE_BUDGETS') && (
          <button type="button" onClick={() => setShowCreate(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            New Budget
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
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
            No budgets found.
          </p>
        ) : (
          <div className="budget-list flex flex-col gap-3">
            {rows.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/budgets/${b.id}`)}
                className="budget-card flex flex-col gap-2 rounded-xl border p-4 text-left transition-shadow hover:shadow-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {b.name}
                    </span>
                    <span className="ml-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {b.scope} · {b.periodLabel}
                    </span>
                  </div>
                  <StatusBadge status={b.status} entity="budget" />
                </div>
                {b.utilizationPercent != null ? (
                  <>
                    <ProgressBar value={b.actual} max={b.plannedAmount} />
                    <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      <span className="num">
                        {formatCurrency(b.actual)} / {formatCurrency(b.plannedAmount)}
                      </span>
                      <span className="num font-semibold" style={{ color: b.isExceeded ? 'var(--danger)' : 'var(--ink-muted)' }}>
                        {b.utilizationPercent}%
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="num text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                    Planned: {formatCurrency(b.plannedAmount)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <BudgetFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </AppShell>
  )
}
