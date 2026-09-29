import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import ApprovalRow from '../../components/ui/ApprovalRow'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import ClaimDetailModal from './ClaimDetailModal'

export default function ExpenseApprovals() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const canManagerQueue = can('APPROVE_EXPENSE')
  const canFinanceQueue = can('VERIFY_EXPENSE')
  // A caller with both (currently only Super Admin, via the bypass) gets a
  // toggle; Finance Admin defaults to the finance queue, Manager/Team Lead
  // to the manager queue, per spec.
  const [queueType, setQueueType] = useState(canFinanceQueue ? 'finance' : 'manager')

  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actioningId, setActioningId] = useState(null)
  const [viewingClaimId, setViewingClaimId] = useState(null)

  const status = queueType === 'manager' ? 'SUBMITTED' : 'MANAGER_APPROVED'

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const { rows: fetched } = await expensesApi.listClaims({ status, pageSize: 100 })
      // Defensive: the backend doesn't explicitly exclude the viewer's own
      // claims from their own approval queue, so filter them out here.
      setRows(fetched.filter((row) => row.employeeId !== user?.employee?.id))
    } catch (err) {
      setError(unwrapError(err, 'Could not load the approval queue.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueType])

  async function act(claim, decision) {
    let comment
    if (decision === 'REJECT' || decision === 'RETURN') {
      comment = window.prompt(`Reason for ${decision === 'REJECT' ? 'rejecting' : 'returning'} this claim (required):`)
      if (comment === null) return
      if (!comment.trim()) {
        setError('A comment is required to reject or return a claim.')
        return
      }
    }

    setActioningId(claim.id)
    setError('')
    try {
      const review = queueType === 'manager' ? expensesApi.managerReview : expensesApi.financeReview
      await review(claim.id, decision, comment)
      setRows((prev) => prev.filter((r) => r.id !== claim.id))
    } catch (err) {
      setError(unwrapError(err, 'Could not record that decision.'))
    } finally {
      setActioningId(null)
    }
  }

  return (
    <AppShell navItems={navItems} title="Expense Approvals" subtitle="Review and act on employee expense claims.">
      <div className="flex flex-col gap-5">
        {canManagerQueue && canFinanceQueue && (
          <div className="flex gap-2">
            {[
              { key: 'manager', label: 'Manager Queue' },
              { key: 'finance', label: 'Finance Queue' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setQueueType(tab.key)}
                className="rounded-full border px-3 py-1.5 text-[12px] font-medium"
                style={{
                  borderColor: queueType === tab.key ? 'var(--accent)' : 'var(--border)',
                  background: queueType === tab.key ? 'var(--accent-soft)' : 'var(--surface)',
                  color: queueType === tab.key ? 'var(--accent)' : 'var(--ink-muted)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

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
            Nothing waiting in this queue.
          </p>
        ) : (
          <div className="appr-list rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {rows.map((claim) => (
              <ApprovalRow
                key={claim.id}
                item={claim}
                onApprove={actioningId ? undefined : (c) => act(c, 'APPROVE')}
                onReturn={actioningId ? undefined : (c) => act(c, 'RETURN')}
                onReject={actioningId ? undefined : (c) => act(c, 'REJECT')}
                renderContent={(claim) => (
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                      {claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName}` : '—'} ·{' '}
                      <span className="num">{formatCurrency(claim.amount)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {claim.category?.name} · {claim.purpose}
                      <span className="num"> · {formatDate(claim.updatedAt)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewingClaimId(claim.id)}
                      className="mt-1 text-[12px] font-medium"
                      style={{ color: 'var(--accent)' }}
                    >
                      View claim &amp; receipt
                    </button>
                  </div>
                )}
              />
            ))}
          </div>
        )}
      </div>

      {viewingClaimId && <ClaimDetailModal claimId={viewingClaimId} onClose={() => setViewingClaimId(null)} />}
    </AppShell>
  )
}
