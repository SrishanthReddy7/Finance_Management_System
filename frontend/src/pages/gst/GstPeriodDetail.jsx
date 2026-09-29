import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as gstApi from '../../api/gst'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

const STEPPER_STEPS = ['In Preparation', 'Ready', 'Filed', 'Acknowledged']
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function stepperIndexFor(status) {
  switch (status) {
    case 'IN_PREPARATION':
      return 0
    case 'READY':
      return 1
    case 'FILED':
      return 2
    case 'ACKNOWLEDGED':
      return 3
    default:
      return null
  }
}

export default function GstPeriodDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)
  const [filingData, setFilingData] = useState(null)
  const [showFilingData, setShowFilingData] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    gstApi
      .getPeriodSummary(id)
      .then(setData)
      .catch((err) => setError(unwrapError(err, 'Could not load this GST period.')))
      .finally(() => setIsLoading(false))
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
      load()
    } catch (err) {
      setError(unwrapError(err, 'That action could not be completed.'))
    } finally {
      setIsActing(false)
    }
  }

  function handleStartPreparation() {
    runAction(() => gstApi.preparePeriod(id, 'IN_PREPARATION'))
  }
  function handleMarkReady() {
    runAction(() => gstApi.preparePeriod(id, 'READY'))
  }
  function handleBackToPreparation() {
    runAction(() => gstApi.preparePeriod(id, 'IN_PREPARATION'))
  }
  function handleMarkFiled() {
    const referenceNo = window.prompt('ARN / reference number (optional, can be added later on Acknowledge):') || undefined
    runAction(() => gstApi.markFiled(id, { referenceNo }))
  }
  function handleAcknowledge() {
    const referenceNo = window.prompt('Acknowledgement / ARN reference (required):')
    if (referenceNo === null) return
    if (!referenceNo.trim()) {
      setError('An acknowledgement reference is required.')
      return
    }
    runAction(() => gstApi.acknowledgePeriod(id, { referenceNo }))
  }

  async function handleViewFilingData() {
    setError('')
    try {
      const fd = await gstApi.getFilingData(id)
      setFilingData(fd)
      setShowFilingData(true)
    } catch (err) {
      setError(unwrapError(err, 'Could not load filing data.'))
    }
  }

  const period = data?.period
  const isOwnPeriod = period?.preparedById === user?.id
  const stepperIndex = period ? stepperIndexFor(period.status) : null

  const lineColumns = [
    { key: 'documentDate', label: 'Date', render: (row) => formatDate(row.documentDate) },
    { key: 'documentType', label: 'Type', render: (row) => row.documentType.replace(/_/g, ' ') },
    { key: 'documentNumber', label: 'Document #', render: (row) => <span className="num">{row.documentNumber || '—'}</span> },
    { key: 'counterpartyName', label: 'Counterparty', render: (row) => row.counterpartyName || '—' },
    { key: 'direction', label: 'Direction' },
    { key: 'taxableAmount', label: 'Taxable', align: 'right', render: (row) => <span className="num">{formatCurrency(row.taxableAmount)}</span> },
    { key: 'totalTax', label: 'Total Tax', align: 'right', render: (row) => <span className="num">{formatCurrency(row.totalTax)}</span> },
  ]

  return (
    <AppShell navItems={navItems} title="GST Period Detail" subtitle="Totals, transactions and filing actions for this period.">
      <div className="flex flex-col gap-6">
        <Link to="/gst" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to GST & Filings
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
        ) : period ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between">
                <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {MONTH_NAMES[period.periodMonth]} {period.periodYear}
                </h2>
                <div className="text-right">
                  <StatusBadge status={period.status} entity="gstFiling" />
                  <div className="num mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(data.summary?.net?.payable)}
                  </div>
                </div>
              </div>

              {stepperIndex !== null && (
                <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
                  <WorkflowStepper steps={STEPPER_STEPS} currentIndex={stepperIndex} />
                </div>
              )}

              <dl className="mt-6 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Output Tax">
                  <span className="num">{formatCurrency(data.summary?.output?.totalTax)}</span>
                </Field>
                <Field label="Input Tax Credit">
                  <span className="num">{formatCurrency(data.summary?.inputTaxCredit)}</span>
                </Field>
                <Field label="Reconciliation">
                  <span style={{ color: data.reconciliation?.balanced ? 'var(--success)' : 'var(--danger)' }}>
                    {data.reconciliation?.balanced ? 'Balanced' : 'Discrepancy'}
                  </span>
                </Field>
                <Field label="Reference No.">{period.referenceNo || '—'}</Field>
              </dl>

              <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                {can('PREPARE_GST_FILING') && period.status === 'NOT_STARTED' && (
                  <ActionButton onClick={handleStartPreparation} disabled={isActing}>
                    Start Preparation
                  </ActionButton>
                )}
                {can('PREPARE_GST_FILING') && period.status === 'IN_PREPARATION' && (
                  <ActionButton onClick={handleMarkReady} disabled={isActing}>
                    Mark Ready
                  </ActionButton>
                )}
                {can('PREPARE_GST_FILING') && period.status === 'READY' && (
                  <ActionButton onClick={handleBackToPreparation} disabled={isActing} variant="danger">
                    Back to Preparation
                  </ActionButton>
                )}
                {can('SUBMIT_GST_FILING') && period.status === 'READY' && (
                  <ActionButton
                    onClick={handleMarkFiled}
                    disabled={isActing || isOwnPeriod}
                    title={isOwnPeriod ? 'You prepared this period — filing requires a different user.' : undefined}
                  >
                    Mark Filed
                  </ActionButton>
                )}
                {can('SUBMIT_GST_FILING') && period.status === 'FILED' && (
                  <ActionButton onClick={handleAcknowledge} disabled={isActing}>
                    Acknowledge
                  </ActionButton>
                )}
                {can('PREPARE_GST_FILING') && (
                  <ActionButton onClick={handleViewFilingData} disabled={isActing} variant="secondary">
                    View Filing Data
                  </ActionButton>
                )}
              </div>
            </div>

            {(data.reconciliation?.mismatchedDocuments?.length > 0 || data.reconciliation?.documentsMissingGst?.length > 0) && (
              <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                {data.reconciliation.mismatchedDocuments?.length ?? 0} mismatched document(s),{' '}
                {data.reconciliation.documentsMissingGst?.length ?? 0} document(s) missing GST records.
              </div>
            )}

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Approval History
              </h3>
              {data.approvalHistory?.length ? (
                <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {data.approvalHistory.map((step) => (
                    <div key={step.id} className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                      <span style={{ color: 'var(--ink)' }}>
                        {step.fromStatus} → {step.toStatus}
                        {step.actor ? ` · ${step.actor.employee ? `${step.actor.employee.firstName} ${step.actor.employee.lastName}` : step.actor.email}` : ''}
                      </span>
                      <span className="num text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        {formatDate(step.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No actions recorded yet.
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {showFilingData && filingData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={() => setShowFilingData(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border p-6"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="mb-4 text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
              Filing Data — {MONTH_NAMES[period?.periodMonth]} {period?.periodYear}
            </h2>
            {filingData.lines?.length ? (
              <DataTable columns={lineColumns} rows={filingData.lines} />
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                No transactions in this period.
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setShowFilingData(false)} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                Close
              </button>
            </div>
          </div>
        </div>
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
  const style =
    variant === 'danger'
      ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
      : variant === 'secondary'
        ? { background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)' }
        : { background: 'var(--accent)', color: '#fff' }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40" style={style}>
      {children}
    </button>
  )
}
