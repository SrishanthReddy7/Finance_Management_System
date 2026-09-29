import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import ClaimDetailModal from './ClaimDetailModal'
import MarkReimbursementPaidModal from './MarkReimbursementPaidModal'

// FRS Section 31 "Reimbursements: Finance -- mark paid, record payment reference".
const TABS = [
  { key: 'REIMBURSEMENT_PENDING', label: 'Awaiting Payment' },
  { key: 'PAID', label: 'Paid' },
]

export default function Reimbursements() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [tab, setTab] = useState('REIMBURSEMENT_PENDING')
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [payingClaim, setPayingClaim] = useState(null)
  const [viewingClaimId, setViewingClaimId] = useState(null)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const { rows: fetched } = await expensesApi.listClaims({ status: tab, pageSize: 100 })
      setRows(fetched)
    } catch (err) {
      setError(unwrapError(err, 'Could not load reimbursements.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const pendingTab = tab === 'REIMBURSEMENT_PENDING'

  return (
    <AppShell navItems={navItems} title="Reimbursements" subtitle="Approved claims waiting for payment, and payment history.">
      <div className="flex flex-col gap-5">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium"
              style={{
                borderColor: tab === t.key ? 'var(--accent)' : 'var(--border)',
                background: tab === t.key ? 'var(--accent-soft)' : 'var(--surface)',
                color: tab === t.key ? 'var(--accent)' : 'var(--ink-muted)',
              }}
            >
              {t.label}
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
            {pendingTab ? 'No approved claims are waiting for payment.' : 'No reimbursements have been paid yet.'}
          </p>
        ) : (
          <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {rows.map((claim, index) => (
              <div
                key={claim.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--border)' }}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                    {claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName}` : '—'} ·{' '}
                    <span className="num">{formatCurrency(claim.amount)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {claim.category?.name} · {claim.purpose}
                    <span className="num"> · {formatDate(claim.updatedAt)}</span>
                  </div>
                  <button type="button" onClick={() => setViewingClaimId(claim.id)} className="mt-1 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                    View claim &amp; receipt
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={claim.status} entity="expense" />
                  {pendingTab && (
                    <button
                      type="button"
                      onClick={() => setPayingClaim(claim)}
                      className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {payingClaim && (
        <MarkReimbursementPaidModal
          claim={payingClaim}
          onClose={() => setPayingClaim(null)}
          onSaved={() => {
            setPayingClaim(null)
            load()
          }}
        />
      )}
      {viewingClaimId && <ClaimDetailModal claimId={viewingClaimId} onClose={() => setViewingClaimId(null)} />}
    </AppShell>
  )
}
