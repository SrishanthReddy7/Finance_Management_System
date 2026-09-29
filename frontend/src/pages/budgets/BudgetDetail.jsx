import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import ProgressBar from '../../components/ui/ProgressBar'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as budgetsApi from '../../api/budgets'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'

export default function BudgetDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [utilization, setUtilization] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    budgetsApi
      .getUtilization(id)
      .then(setUtilization)
      .catch((err) => setError(unwrapError(err, 'Could not load this budget.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function changeStatus(status) {
    setIsActing(true)
    setError('')
    try {
      await budgetsApi.setBudgetStatus(id, status)
      load()
    } catch (err) {
      setError(unwrapError(err, 'Could not change this budget\'s status.'))
    } finally {
      setIsActing(false)
    }
  }

  const breakdownEntries = utilization?.breakdown ? Object.entries(utilization.breakdown) : []

  return (
    <AppShell navItems={navItems} title="Budget Detail" subtitle="Planned vs actual spend for this budget.">
      <div className="flex flex-col gap-6">
        <Link to="/budgets" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Budgets
        </Link>

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : utilization ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {utilization.name}
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {utilization.scope} · {utilization.periodLabel}
                  </p>
                </div>
                <StatusBadge status={utilization.status} entity="budget" />
              </div>

              <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                <ProgressBar value={utilization.actual} max={utilization.plannedAmount} showLabel />
              </div>

              <dl className="mt-5 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Planned">
                  <span className="num">{formatCurrency(utilization.plannedAmount)}</span>
                </Field>
                <Field label="Actual">
                  <span className="num">{formatCurrency(utilization.actual)}</span>
                </Field>
                <Field label="Committed">
                  <span className="num">{formatCurrency(utilization.committed)}</span>
                </Field>
                <Field label="Remaining">
                  <span className="num" style={{ color: utilization.remaining < 0 ? 'var(--danger)' : 'var(--ink)' }}>
                    {formatCurrency(utilization.remaining)}
                  </span>
                </Field>
              </dl>

              {can('MANAGE_BUDGETS') && (
                <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                  {utilization.status === 'DRAFT' && (
                    <ActionButton onClick={() => changeStatus('ACTIVE')} disabled={isActing}>
                      Activate
                    </ActionButton>
                  )}
                  {utilization.status !== 'CLOSED' && (
                    <ActionButton onClick={() => changeStatus('CLOSED')} disabled={isActing} variant="danger">
                      Close Budget
                    </ActionButton>
                  )}
                </div>
              )}
            </div>

            {utilization.warnings?.length > 0 && (
              <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                {utilization.warnings.join(' · ')}
              </div>
            )}

            {breakdownEntries.length > 0 && (
              <div>
                <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                  Breakdown
                </h3>
                <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {breakdownEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                      <span style={{ color: 'var(--ink)' }}>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                      <span className="num font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(typeof value === 'number' ? value : value?.amount ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </dt>
      <dd style={{ color: 'var(--ink)' }}>{children}</dd>
    </div>
  )
}

function ActionButton({ onClick, disabled, variant, children }) {
  const isDanger = variant === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
      style={isDanger ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--accent)', color: '#fff' }}
    >
      {children}
    </button>
  )
}
