import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import * as salariesApi from '../../api/salaries'
import { formatCurrency, formatDate } from '../../utils/format'
import SalaryStructureFormModal from './SalaryStructureFormModal'

// Shared between the Employee Profile page and the dedicated Salary
// Structures page. A denied caller gets a 404 from the backend (not 403,
// deliberately, per FRS 8.3) -- rendered here as a quiet "not available"
// rather than a raw error, since a 404 on this endpoint just means "not
// visible to you," not "broken."
export default function SalaryStructurePanel({ employeeId }) {
  const { can } = useAuth()
  const [data, setData] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  function load() {
    setIsLoading(true)
    setNotFound(false)
    salariesApi
      .getSalaryStructure(employeeId)
      .then(setData)
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true)
      })
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  if (isLoading) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Loading…
      </p>
    )
  }

  if (notFound) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
        Salary information is not available to you for this employee.
      </p>
    )
  }

  const { current, history } = data || {}

  return (
    <div className="flex flex-col gap-4">
      {current ? (
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-start justify-between">
            <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Effective from {formatDate(current.effectiveFrom)}
            </div>
            <div className="num text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
              {formatCurrency(current.netSalary)}
              <span className="ml-1 text-[12px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                / month
              </span>
            </div>
          </div>
          <div className="sal-comp mt-3 grid grid-cols-2 gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {current.components.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-[13px]">
                <span style={{ color: 'var(--ink-muted)' }}>{c.label}</span>
                <span className="num" style={{ color: c.type === 'DEDUCTION' ? 'var(--danger)' : 'var(--ink)' }}>
                  {c.type === 'DEDUCTION' ? '−' : ''}
                  {formatCurrency(c.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No salary structure has been set for this employee yet.
        </p>
      )}

      {can('MANAGE_SALARY') && (
        <div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Revision
          </button>
        </div>
      )}

      {history?.length > 0 && (
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Revision History
          </h4>
          <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <span style={{ color: 'var(--ink)' }}>Effective {formatDate(h.effectiveFrom)}</span>
                <span className="num font-medium" style={{ color: 'var(--ink)' }}>
                  {formatCurrency(h.netSalary)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <SalaryStructureFormModal
          employeeId={employeeId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            load()
          }}
        />
      )}
    </div>
  )
}
