import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as vendorBillsApi from '../../api/vendorBills'
import * as payoutsApi from '../../api/payouts'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import RecordVendorPaymentModal from './RecordVendorPaymentModal'

export default function VendorBillDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [bill, setBill] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState(false)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      setBill(await vendorBillsApi.getVendorBill(id))
    } catch (err) {
      setError(unwrapError(err, 'Could not load this vendor bill.'))
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
    setNotice('')
    try {
      await action()
      await load()
    } catch (err) {
      setError(unwrapError(err, 'That action could not be completed.'))
    } finally {
      setIsActing(false)
    }
  }

  function handleSubmit() {
    runAction(() => vendorBillsApi.submitVendorBill(id))
  }
  function handleVerify() {
    runAction(() => vendorBillsApi.verifyVendorBill(id))
  }
  function handleSendForApproval() {
    runAction(() => vendorBillsApi.sendVendorBillForApproval(id))
  }
  function handleApprove() {
    runAction(() => vendorBillsApi.approveVendorBill(id))
  }
  function handleReopen() {
    runAction(() => vendorBillsApi.reopenVendorBill(id))
  }
  function handleReject() {
    const reason = window.prompt('Reason for rejecting this bill (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to reject a bill.')
      return
    }
    runAction(() => vendorBillsApi.rejectVendorBill(id, reason))
  }
  function handleCancel() {
    const reason = window.prompt('Reason for cancelling this bill (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to cancel a bill.')
      return
    }
    runAction(() => vendorBillsApi.cancelVendorBill(id, reason))
  }
  async function handleInitiatePayout() {
    setIsActing(true)
    setError('')
    setNotice('')
    try {
      const payout = await payoutsApi.createVendorPayout(id)
      setNotice('Payout initiated. It will record a matching payment on this bill once it processes.')
      navigate(`/payouts/${payout.id}`)
    } catch (err) {
      setError(unwrapError(err, 'Could not initiate a payout for this bill.'))
    } finally {
      setIsActing(false)
    }
  }

  const isOwnBill = bill?.createdById === user?.id
  const canReject = can('VERIFY_VENDOR_BILL') || can('APPROVE_VENDOR_BILL')
  const canPayoutOrPay = bill && ['APPROVED', 'PARTIALLY_PAID'].includes(bill.status)

  const lineItemColumns = [
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.amount)}</span> },
    { key: 'taxRate', label: 'Tax %', align: 'right', render: (row) => <span className="num">{row.taxRate ? `${row.taxRate}%` : '—'}</span> },
    { key: 'taxAmount', label: 'Tax Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.taxAmount)}</span> },
  ]

  const paymentColumns = [
    { key: 'paymentDate', label: 'Date', render: (row) => formatDate(row.paymentDate) },
    { key: 'amount', label: 'Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.amount)}</span> },
    { key: 'method', label: 'Method', render: (row) => row.method.replace(/_/g, ' ') },
    { key: 'referenceNo', label: 'Reference', render: (row) => row.referenceNo || '—' },
  ]

  return (
    <AppShell navItems={navItems} title="Vendor Bill Detail" subtitle="Verification, approval and payment status for this bill.">
      <div className="flex flex-col gap-6">
        <Link to="/vendor-bills" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Vendor Bills
        </Link>

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
            {notice}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : bill ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="num text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {bill.billNumber}
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {bill.vendor?.name}
                    {bill.project?.name ? ` · ${bill.project.name}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={bill.status} entity="vendorBill" />
                  <div className="num mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(bill.totals?.totalAmount ?? bill.totalAmount)}
                  </div>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Bill Date">{formatDate(bill.billDate)}</Field>
                <Field label="Due Date">{formatDate(bill.dueDate)}</Field>
                <Field label="Paid">
                  <span className="num">{formatCurrency(bill.ap?.amountPaid)}</span>
                </Field>
                <Field label="Outstanding">
                  <span className="num" style={{ color: bill.ap?.isOverdue ? 'var(--danger)' : 'var(--ink)' }}>
                    {formatCurrency(bill.ap?.outstandingAmount)}
                  </span>
                </Field>
              </dl>

              <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Bank Details">
                  {bill.vendor?.bankDetailsRedacted ? (
                    <span style={{ color: 'var(--ink-faint)' }}>Hidden — requires vendor payment access</span>
                  ) : (
                    <span>{bill.vendor?.bankDetails || '—'}</span>
                  )}
                </Field>
                <Field label="PO Reference">{bill.poReference || '—'}</Field>
              </dl>

              <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                {can('MANAGE_VENDORS') && bill.status === 'DRAFT' && (
                  <ActionButton onClick={handleSubmit} disabled={isActing}>
                    Submit for Verification
                  </ActionButton>
                )}
                {can('VERIFY_VENDOR_BILL') && bill.status === 'PENDING_VERIFICATION' && (
                  <ActionButton onClick={handleVerify} disabled={isActing}>
                    Verify
                  </ActionButton>
                )}
                {can('VERIFY_VENDOR_BILL') && bill.status === 'VERIFIED' && (
                  <ActionButton onClick={handleSendForApproval} disabled={isActing}>
                    Send for Approval
                  </ActionButton>
                )}
                {can('APPROVE_VENDOR_BILL') && bill.status === 'PENDING_APPROVAL' && (
                  <ActionButton
                    onClick={handleApprove}
                    disabled={isActing || isOwnBill}
                    title={isOwnBill ? 'You entered this bill — a different approver is required.' : undefined}
                  >
                    Approve
                  </ActionButton>
                )}
                {canReject && ['PENDING_VERIFICATION', 'VERIFIED', 'PENDING_APPROVAL'].includes(bill.status) && (
                  <ActionButton onClick={handleReject} disabled={isActing} variant="danger">
                    Reject
                  </ActionButton>
                )}
                {can('MANAGE_VENDORS') && bill.status === 'REJECTED' && (
                  <ActionButton onClick={handleReopen} disabled={isActing}>
                    Reopen
                  </ActionButton>
                )}
                {can('RECORD_VENDOR_PAYMENT') && canPayoutOrPay && (
                  <ActionButton onClick={() => setShowRecordPayment(true)} disabled={isActing}>
                    Record Payment
                  </ActionButton>
                )}
                {can('INITIATE_PAYOUT') && canPayoutOrPay && (
                  <ActionButton onClick={handleInitiatePayout} disabled={isActing}>
                    Initiate Payout
                  </ActionButton>
                )}
                {can('APPROVE_VENDOR_BILL') && !['PAID', 'CANCELLED', 'REJECTED'].includes(bill.status) && (
                  <ActionButton onClick={handleCancel} disabled={isActing} variant="danger">
                    Cancel Bill
                  </ActionButton>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Line Items
              </h3>
              <DataTable columns={lineItemColumns} rows={bill.items || []} />
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Payment History
              </h3>
              {bill.payments?.length ? (
                <DataTable columns={paymentColumns} rows={bill.payments} />
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No payments recorded yet.
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {showRecordPayment && (
        <RecordVendorPaymentModal
          billId={id}
          outstandingAmount={bill?.ap?.outstandingAmount}
          onClose={() => setShowRecordPayment(false)}
          onSaved={() => {
            setShowRecordPayment(false)
            load()
          }}
        />
      )}
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
