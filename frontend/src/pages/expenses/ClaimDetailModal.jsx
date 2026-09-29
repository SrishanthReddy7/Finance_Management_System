import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import StatusBadge from '../../components/ui/StatusBadge'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

export default function ClaimDetailModal({ claimId, onClose }) {
  const [claim, setClaim] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    expensesApi
      .getClaim(claimId)
      .then((data) => {
        if (!cancelled) setClaim(data)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load this claim.'))
      })
    return () => {
      cancelled = true
    }
  }, [claimId])

  async function openReceipt(receiptId) {
    try {
      const url = await expensesApi.getReceiptObjectUrl(claimId, receiptId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(unwrapError(err, 'Could not open receipt.'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            Expense Claim
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--ink-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {!claim ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={claim.status} entity="expense" />
              <span className="num text-[18px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(claim.amount)}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Field label="Employee">{claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName}` : '—'}</Field>
              <Field label="Category">{claim.category?.name || '—'}</Field>
              <Field label="Date">{formatDate(claim.expenseDate)}</Field>
              <Field label="Payment Method">{claim.paymentMethod}</Field>
              <Field label="Purpose" span>
                {claim.purpose}
              </Field>
              {claim.receiptMissing && (
                <Field label="Missing Receipt Reason" span>
                  {claim.receiptMissingReason}
                </Field>
              )}
            </dl>

            {claim.warnings?.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {claim.warnings.map((w) => (
                  <div key={w.code} className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                    {w.message}
                  </div>
                ))}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
                Receipts
              </h3>
              {claim.receipts?.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {claim.receipts.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => openReceipt(r.id)}
                        className="text-[13px] font-medium"
                        style={{ color: 'var(--accent)' }}
                      >
                        {r.originalFileName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No receipt attached.
                </p>
              )}
            </div>

            {claim.approvalHistory?.length > 0 && (
              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
                  Approval History
                </h3>
                <ul className="flex flex-col gap-2">
                  {claim.approvalHistory.map((step) => (
                    <li key={step.id} className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>
                        {step.actor?.employee ? `${step.actor.employee.firstName} ${step.actor.employee.lastName}` : step.actor?.email}
                      </span>{' '}
                      {step.fromStatus} → {step.toStatus}
                      {step.comment && <span> — "{step.comment}"</span>}
                      <span className="num"> ({formatDate(step.createdAt)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children, span }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <dt className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </dt>
      <dd style={{ color: 'var(--ink)' }}>{children}</dd>
    </div>
  )
}
