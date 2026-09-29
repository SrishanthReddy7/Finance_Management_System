import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import TypeChip from '../../components/ui/TypeChip'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payoutsApi from '../../api/payouts'
import * as vendorBillsApi from '../../api/vendorBills'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

const PURPOSE_COLORS = {
  REIMBURSEMENT: 'var(--info)',
  SALARY: 'var(--accent)',
  VENDOR_PAYMENT: 'var(--warning)',
}

export default function PayoutDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [payout, setPayout] = useState(null)
  const [vendorBill, setVendorBill] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const data = await payoutsApi.getPayout(id)
      setPayout(data)
      if (data.vendorBillId) {
        vendorBillsApi.getVendorBill(data.vendorBillId).then(setVendorBill).catch(() => setVendorBill(null))
      }
    } catch (err) {
      setError(unwrapError(err, 'Could not load this payout.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function runAction(action) {
    setIsActing(true)
    setError('')
    try {
      await action()
      await load()
    } catch (err) {
      setError(unwrapError(err, 'That action could not be completed.'))
    } finally {
      setIsActing(false)
    }
  }

  function handleApprove() {
    runAction(() => payoutsApi.approvePayout(id))
  }
  function handleReject() {
    const reason = window.prompt('Reason for rejecting this payout (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to reject a payout.')
      return
    }
    runAction(() => payoutsApi.rejectPayout(id, reason))
  }
  function handleCancel() {
    const reason = window.prompt('Reason for cancelling this payout (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to cancel a payout.')
      return
    }
    runAction(() => payoutsApi.cancelPayout(id, reason))
  }
  function handleRetry() {
    runAction(() => payoutsApi.retryPayout(id))
  }
  function handleSync() {
    runAction(() => payoutsApi.syncPayout(id))
  }

  const isOwnPayout = payout?.initiatedById === user?.id
  const canOperate = can('INITIATE_PAYOUT') || can('APPROVE_PAYOUT')

  return (
    <AppShell navItems={navItems} title="Payout Detail" subtitle="Approval trail and transaction details for this payout.">
      <div className="flex flex-col gap-6">
        <Link to="/payouts" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Payouts
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
        ) : payout ? (
          <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <TypeChip label={payout.purpose.replace(/_/g, ' ')} color={PURPOSE_COLORS[payout.purpose]} />
                </div>
                <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  {vendorBill ? `${vendorBill.billNumber} · ${vendorBill.vendor?.name}` : 'Provider: Mock'}
                </p>
              </div>
              <div className="text-right">
                <StatusBadge status={payout.status} entity="payout" />
                <div className="num mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                  {formatCurrency(payout.amount)}
                </div>
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <Field label="Provider">{payout.provider}</Field>
              <Field label="Provider Status">{payout.providerStatus || '—'}</Field>
              <Field label="UTR">
                <span className="num">{payout.utr || '—'}</span>
              </Field>
              <Field label="Approved At">{formatDate(payout.approvedAt)}</Field>
            </dl>

            {payout.failureReason && (
              <div className="mt-5 rounded-lg border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Failure Reason">{payout.failureReason}</Field>
              </div>
            )}

            {vendorBill && (
              <div className="mt-5 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Link to={`/vendor-bills/${vendorBill.id}`} className="font-medium" style={{ color: 'var(--accent)' }}>
                  View vendor bill {vendorBill.billNumber} →
                </Link>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
              {can('APPROVE_PAYOUT') && payout.status === 'AWAITING_APPROVAL' && (
                <ActionButton
                  onClick={handleApprove}
                  disabled={isActing || isOwnPayout}
                  title={isOwnPayout ? 'You initiated this payout — a different approver is required.' : undefined}
                >
                  Approve
                </ActionButton>
              )}
              {can('APPROVE_PAYOUT') && payout.status === 'AWAITING_APPROVAL' && (
                <ActionButton onClick={handleReject} disabled={isActing || isOwnPayout} variant="danger">
                  Reject
                </ActionButton>
              )}
              {can('APPROVE_PAYOUT') && payout.status === 'AWAITING_APPROVAL' && (
                <ActionButton onClick={handleCancel} disabled={isActing} variant="danger">
                  Cancel
                </ActionButton>
              )}
              {can('APPROVE_PAYOUT') && ['FAILED', 'QUEUED'].includes(payout.status) && (
                <ActionButton onClick={handleRetry} disabled={isActing}>
                  Retry
                </ActionButton>
              )}
              {canOperate && ['QUEUED', 'PROCESSING'].includes(payout.status) && (
                <ActionButton onClick={handleSync} disabled={isActing}>
                  Refresh Status
                </ActionButton>
              )}
            </div>
          </div>
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

function ActionButton({ onClick, disabled, title, variant, children }) {
  const isDanger = variant === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
      style={
        isDanger
          ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
          : { background: 'var(--accent)', color: '#fff' }
      }
    >
      {children}
    </button>
  )
}
