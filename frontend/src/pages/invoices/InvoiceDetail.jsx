import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as invoicesApi from '../../api/invoices'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import RecordPaymentModal from './RecordPaymentModal'

const STEPPER_STEPS = ['Draft', 'Approved', 'Sent', 'Paid']

function stepperPropsFor(status) {
  switch (status) {
    case 'DRAFT':
    case 'PENDING_APPROVAL':
      return { steps: STEPPER_STEPS, currentIndex: 0 }
    case 'APPROVED':
      return { steps: STEPPER_STEPS, currentIndex: 1 }
    case 'SENT':
    case 'PARTIALLY_PAID':
      return { steps: STEPPER_STEPS, currentIndex: 2 }
    case 'OVERDUE':
      return { steps: STEPPER_STEPS, currentIndex: 2, warningIndex: 2 }
    case 'PAID':
      return { steps: STEPPER_STEPS, currentIndex: 3 }
    default:
      return null
  }
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [invoice, setInvoice] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState(false)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      setInvoice(await invoicesApi.getInvoice(id))
    } catch (err) {
      setError(unwrapError(err, 'Could not load this invoice.'))
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

  function handleSubmit() {
    runAction(() => invoicesApi.submitInvoice(id))
  }

  function handleApprove() {
    runAction(() => invoicesApi.approveInvoice(id))
  }

  function handleSend() {
    runAction(() => invoicesApi.sendInvoice(id))
  }

  function handleCancel() {
    const reason = window.prompt('Reason for cancelling this invoice (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to cancel an invoice.')
      return
    }
    runAction(() => invoicesApi.cancelInvoice(id, reason))
  }

  const stepper = invoice && invoice.status !== 'CANCELLED' ? stepperPropsFor(invoice.status) : null
  const isOwnInvoice = invoice?.createdById === user?.id

  const lineItemColumns = [
    { key: 'description', label: 'Description' },
    { key: 'quantity', label: 'Qty', align: 'right', render: (row) => <span className="num">{row.quantity}</span> },
    { key: 'rate', label: 'Rate', align: 'right', render: (row) => <span className="num">{formatCurrency(row.rate)}</span> },
    { key: 'taxRate', label: 'Tax %', align: 'right', render: (row) => <span className="num">{row.taxRate ? `${row.taxRate}%` : '—'}</span> },
    { key: 'discount', label: 'Discount', align: 'right', render: (row) => <span className="num">{row.discount ? formatCurrency(row.discount) : '—'}</span> },
    { key: 'lineTotal', label: 'Line Total', align: 'right', render: (row) => <span className="num">{formatCurrency(row.lineTotal)}</span> },
  ]

  const paymentColumns = [
    { key: 'paymentDate', label: 'Date', render: (row) => formatDate(row.paymentDate) },
    { key: 'amount', label: 'Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.amount)}</span> },
    { key: 'method', label: 'Method', render: (row) => row.method.replace(/_/g, ' ') },
    { key: 'referenceNo', label: 'Reference', render: (row) => row.referenceNo || '—' },
  ]

  return (
    <AppShell navItems={navItems} title="Invoice Detail" subtitle="Line items, payments and approval workflow for this invoice.">
      <div className="flex flex-col gap-6">
        <Link to="/invoices" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Invoices
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
        ) : invoice ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="num text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {invoice.invoiceNumber}
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {invoice.client?.name}
                    {invoice.project?.name ? ` · ${invoice.project.name}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={invoice.status} entity="invoice" />
                  <div className="num mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(invoice.totals?.totalAmount ?? invoice.totalAmount)}
                  </div>
                </div>
              </div>

              {stepper && (
                <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
                  <WorkflowStepper {...stepper} />
                </div>
              )}

              <dl className="mt-6 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Invoice Date">{formatDate(invoice.invoiceDate)}</Field>
                <Field label="Due Date">{formatDate(invoice.dueDate)}</Field>
                <Field label="Received">
                  <span className="num">{formatCurrency(invoice.ar?.amountReceived)}</span>
                </Field>
                <Field label="Remaining">
                  <span className="num">{formatCurrency(invoice.ar?.remainingAmount)}</span>
                </Field>
              </dl>

              <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                {can('CREATE_INVOICE') && invoice.status === 'DRAFT' && (
                  <ActionButton onClick={handleSubmit} disabled={isActing}>
                    Submit for Approval
                  </ActionButton>
                )}
                {can('APPROVE_INVOICE') && invoice.status === 'PENDING_APPROVAL' && (
                  <ActionButton
                    onClick={handleApprove}
                    disabled={isActing || isOwnInvoice}
                    title={isOwnInvoice ? 'You created this invoice — a different approver is required.' : undefined}
                  >
                    Approve
                  </ActionButton>
                )}
                {can('CREATE_INVOICE') && invoice.status === 'APPROVED' && (
                  <ActionButton onClick={handleSend} disabled={isActing}>
                    Send to Client
                  </ActionButton>
                )}
                {can('RECORD_CLIENT_PAYMENT') && ['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
                  <ActionButton onClick={() => setShowRecordPayment(true)} disabled={isActing}>
                    Record Payment
                  </ActionButton>
                )}
                {can('APPROVE_INVOICE') && !['PAID', 'CANCELLED'].includes(invoice.status) && (
                  <ActionButton onClick={handleCancel} disabled={isActing} variant="danger">
                    Cancel Invoice
                  </ActionButton>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Line Items
              </h3>
              <DataTable columns={lineItemColumns} rows={invoice.lineItems || []} />
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Payment History
              </h3>
              {invoice.payments?.length ? (
                <DataTable columns={paymentColumns} rows={invoice.payments} />
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
        <RecordPaymentModal
          invoiceId={id}
          remainingAmount={invoice?.ar?.remainingAmount}
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
