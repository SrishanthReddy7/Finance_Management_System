import { useEffect, useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, Download, X, Search, RotateCcw } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadPayslipPdf } from '../../utils/payslipPdf'
import MarkPayslipPaidModal from './MarkPayslipPaidModal'

const STEPPER_STEPS = ['Draft', 'Processed', 'Finalized', 'Paid']
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function stepperIndexFor(status) {
  switch (status) {
    case 'DRAFT':
      return 0
    case 'PROCESSED':
      return 1
    case 'FINALIZED':
      return 2
    case 'PAID':
      return 3
    default:
      return null
  }
}

export default function PayrollRunDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)
  const [markingPaidId, setMarkingPaidId] = useState(null)

  // Viewing specific employee payslip modal
  const [viewingPayslip, setViewingPayslip] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)

  // Filters for payslips inside the run
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  function load() {
    setIsLoading(true)
    setError('')
    payrollApi
      .getRun(id)
      .then(setRun)
      .catch((err) => setError(unwrapError(err, 'Could not load this payroll run.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleDownload(payslip) {
    setIsDownloading(true)
    try {
      await downloadPayslipPdf(payslip)
    } catch {
      setError('Could not generate the PDF.')
    } finally {
      setIsDownloading(false)
    }
  }

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

  function handleProcess() {
    runAction(() => payrollApi.processRun(id))
  }
  function handleFinalize() {
    runAction(() => payrollApi.finalizeRun(id))
  }
  function handleReject() {
    const reason = window.prompt('Reason for rejecting this run back to Draft (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to reject a run.')
      return
    }
    runAction(() => payrollApi.rejectRun(id, reason))
  }
  function handleCancel() {
    const reason = window.prompt('Reason for cancelling this run (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required to cancel a run.')
      return
    }
    runAction(() => payrollApi.cancelRun(id, reason))
  }
  function handleMarkFailed(payslipId) {
    const reason = window.prompt('Reason this payslip failed (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }
    runAction(() => payrollApi.markPayslipFailed(id, payslipId, reason))
  }

  const isOwnRun = run?.preparedById === user?.id
  const canReview = can('MANAGE_SALARY') || can('APPROVE_PAYROLL')
  const stepperIndex = run ? stepperIndexFor(run.status) : null
  const canOperatePayslips = run && ['FINALIZED', 'PAID'].includes(run.status) && can('MANAGE_SALARY')

  // Filtered payslips list
  const filteredPayslips = useMemo(() => {
    if (!run?.payslips) return []
    return run.payslips.filter((slip) => {
      const q = searchQuery.trim().toLowerCase()
      const fullName = `${slip.employee?.firstName || ''} ${slip.employee?.lastName || ''}`.toLowerCase()
      const code = (slip.employee?.employeeCode || '').toLowerCase()
      const matchesSearch = !q || fullName.includes(q) || code.includes(q)
      const matchesStatus = !statusFilter || slip.paymentStatus === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [run?.payslips, searchQuery, statusFilter])

  const payslipColumns = [
    { key: 'employee', label: 'Employee', render: (row) => `${row.employee.firstName} ${row.employee.lastName}` },
    { key: 'employeeCode', label: 'Code', render: (row) => <span className="num">{row.employee.employeeCode}</span> },
    { key: 'grossEarnings', label: 'Gross', align: 'right', render: (row) => <span className="num">{formatCurrency(row.grossEarnings)}</span> },
    { key: 'totalDeductions', label: 'Deductions', align: 'right', render: (row) => <span className="num text-rose-600">{formatCurrency(row.totalDeductions)}</span> },
    { key: 'netSalary', label: 'Net', align: 'right', render: (row) => <span className="num font-bold text-slate-900">{formatCurrency(row.netSalary)}</span> },
    { key: 'paymentStatus', label: 'Status', render: (row) => <StatusBadge status={row.paymentStatus} entity="paymentStatus" /> },
    {
      key: 'view',
      label: 'Payslip',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => setViewingPayslip(row)}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <Eye size={13} />
          View
        </button>
      ),
    },
    ...(canOperatePayslips
      ? [
          {
            key: 'actions',
            label: 'Process',
            align: 'right',
            render: (row) =>
              row.paymentStatus === 'PAID' ? null : (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setMarkingPaidId(row.id)}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    Mark Paid
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMarkFailed(row.id)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] font-medium text-rose-700 hover:bg-rose-100"
                  >
                    Mark Failed
                  </button>
                </div>
              ),
          },
        ]
      : []),
  ]

  return (
    <AppShell navItems={navItems} title="Payroll Run Detail" subtitle="Payslips, totals and approval actions for this run.">
      <div className="flex flex-col gap-6">
        <Link to="/payroll" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Payroll
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
        ) : run ? (
          <>
            <div className="rounded-xl border p-6 bg-white" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {MONTH_NAMES[run.periodMonth]} {run.periodYear}
                  </h2>
                  {run.notes && (
                    <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                      {run.notes}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <StatusBadge status={run.status} entity="payrollRun" />
                  <div className="num mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(run.summary?.totalNet)}
                  </div>
                </div>
              </div>

              {stepperIndex !== null && (
                <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
                  <WorkflowStepper steps={STEPPER_STEPS} currentStep={stepperIndex} />
                </div>
              )}

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t pt-6 text-[13px] sm:grid-cols-4" style={{ borderColor: 'var(--border)' }}>
                <Field label="Total Gross">{formatCurrency(run.summary?.totalGross)}</Field>
                <Field label="Total Deductions">{formatCurrency(run.summary?.totalDeductions)}</Field>
                <Field label="Total Net">{formatCurrency(run.summary?.totalNet)}</Field>
                <Field label="Paid Employees">
                  {run.summary?.paidCount ?? 0} / {run.summary?.employeeCount ?? 0}
                </Field>
              </dl>

              <div className="mt-6 flex flex-wrap gap-2 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
                {run.status === 'DRAFT' && can('MANAGE_SALARY') && (
                  <ActionButton onClick={handleProcess} disabled={isActing}>
                    Process Run
                  </ActionButton>
                )}
                {run.status === 'PROCESSED' && can('APPROVE_PAYROLL') && (
                  <ActionButton onClick={handleFinalize} disabled={isActing || isOwnRun} title={isOwnRun ? 'You cannot finalize your own run.' : undefined}>
                    Finalize Run
                  </ActionButton>
                )}
                {run.status === 'PROCESSED' && canReview && (
                  <ActionButton onClick={handleReject} disabled={isActing} variant="danger">
                    Reject to Draft
                  </ActionButton>
                )}
                {['DRAFT', 'PROCESSED'].includes(run.status) && canReview && (
                  <ActionButton onClick={handleCancel} disabled={isActing} variant="danger">
                    Cancel Run
                  </ActionButton>
                )}
              </div>
            </div>

            {/* Payslips Section with Filter and Search Controls */}
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-slate-900">
                  Payslips ({filteredPayslips.length} of {run.payslips?.length || 0})
                </h3>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Search by Employee */}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search employee / code…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-800 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Status Filter Chips */}
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
                    {[
                      { label: 'All', value: '' },
                      { label: 'Paid', value: 'PAID' },
                      { label: 'Unpaid', value: 'UNPAID' },
                      { label: 'Failed', value: 'FAILED' },
                    ].map((tab) => (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setStatusFilter(tab.value)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                          statusFilter === tab.value
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {(searchQuery || statusFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('')
                        setStatusFilter('')
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <RotateCcw size={12} />
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {run.payslips?.length ? (
                filteredPayslips.length ? (
                  <DataTable columns={payslipColumns} rows={filteredPayslips} onRowClick={setViewingPayslip} />
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
                    <p className="text-[13px] text-slate-500">No payslips match the filter criteria.</p>
                  </div>
                )
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No payslips yet — process this run to generate them.
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Admin Detailed Payslip Modal */}
      {viewingPayslip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(3px)' }}
          onClick={() => setViewingPayslip(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="mb-4 flex items-start justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Employee Payslip Statement
                </span>
                <h2 className="text-[18px] font-bold text-slate-900">
                  {viewingPayslip.employee?.firstName} {viewingPayslip.employee?.lastName}
                </h2>
                <p className="text-[12px] text-slate-500">
                  Code: {viewingPayslip.employee?.employeeCode} • {run ? `${MONTH_NAMES[run.periodMonth]} ${run.periodYear}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={viewingPayslip.paymentStatus} entity="paymentStatus" />
                <button
                  type="button"
                  onClick={() => setViewingPayslip(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Line Items */}
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Earnings & Allowances
              </div>
              {viewingPayslip.lines
                ?.filter((l) => l.type !== 'DEDUCTION')
                .map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-slate-50">
                    <span className="text-slate-600">{line.label}</span>
                    <span className="num font-semibold text-slate-800">{formatCurrency(line.amount)}</span>
                  </div>
                ))}

              <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Statutory & Other Deductions
              </div>
              {viewingPayslip.lines
                ?.filter((l) => l.type === 'DEDUCTION')
                .map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-slate-50">
                    <span className="text-slate-600">{line.label}</span>
                    <span className="num font-semibold text-rose-600">−{formatCurrency(line.amount)}</span>
                  </div>
                ))}
            </div>

            {/* Totals */}
            <div className="mt-4 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
              <div className="flex items-center justify-between text-[13px] text-slate-600">
                <span>Gross Remuneration:</span>
                <span className="font-semibold text-slate-800">{formatCurrency(viewingPayslip.grossEarnings)}</span>
              </div>
              <div className="flex items-center justify-between text-[13px] text-slate-600 mt-1">
                <span>Total Deductions:</span>
                <span className="font-semibold text-rose-600">−{formatCurrency(viewingPayslip.totalDeductions)}</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2 text-[14px]">
                <span className="font-bold text-slate-900">Net Payable Salary</span>
                <span className="num text-[18px] font-extrabold text-blue-600">
                  {formatCurrency(viewingPayslip.netSalary)}
                </span>
              </div>
            </div>

            {viewingPayslip.paidAt && (
              <p className="mt-3 text-[12px] text-slate-500 text-center">
                Disbursed on {formatDate(viewingPayslip.paidAt)} via {viewingPayslip.paymentMethod?.replace(/_/g, ' ')}
                {viewingPayslip.paymentReferenceNo ? ` • Ref #${viewingPayslip.paymentReferenceNo}` : ''}
              </p>
            )}

            <button
              type="button"
              onClick={() => handleDownload(viewingPayslip)}
              disabled={isDownloading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              <Download size={16} />
              {isDownloading ? 'Generating PDF…' : 'Download Payslip (PDF)'}
            </button>
          </div>
        </div>
      )}

      {markingPaidId && (
        <MarkPayslipPaidModal
          runId={id}
          payslipId={markingPaidId}
          onClose={() => setMarkingPaidId(null)}
          onSaved={() => {
            setMarkingPaidId(null)
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
      style={isDanger ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--accent)', color: '#fff' }}
    >
      {children}
    </button>
  )
}
