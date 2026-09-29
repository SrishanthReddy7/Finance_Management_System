import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
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

  const payslipColumns = [
    { key: 'employee', label: 'Employee', render: (row) => `${row.employee.firstName} ${row.employee.lastName}` },
    { key: 'employeeCode', label: 'Code', render: (row) => <span className="num">{row.employee.employeeCode}</span> },
    { key: 'grossEarnings', label: 'Gross', align: 'right', render: (row) => <span className="num">{formatCurrency(row.grossEarnings)}</span> },
    { key: 'totalDeductions', label: 'Deductions', align: 'right', render: (row) => <span className="num">{formatCurrency(row.totalDeductions)}</span> },
    { key: 'netSalary', label: 'Net', align: 'right', render: (row) => <span className="num font-semibold">{formatCurrency(row.netSalary)}</span> },
    { key: 'paymentStatus', label: 'Status', render: (row) => <StatusBadge status={row.paymentStatus} entity="paymentStatus" /> },
    ...(canOperatePayslips
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) =>
              row.paymentStatus === 'PAID' ? null : (
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setMarkingPaidId(row.id)} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                    Mark Paid
                  </button>
                  <button type="button" onClick={() => handleMarkFailed(row.id)} className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>
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
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
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
                  <WorkflowStepper steps={STEPPER_STEPS} currentIndex={stepperIndex} />
                </div>
              )}

              <dl className="mt-6 grid grid-cols-3 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Employees">
                  <span className="num">{run.summary?.employeeCount ?? 0}</span>
                </Field>
                <Field label="Paid">
                  <span className="num">
                    {run.summary?.paidCount ?? 0} / {run.summary?.employeeCount ?? 0}
                  </span>
                </Field>
                <Field label="Total Deductions">
                  <span className="num">{formatCurrency(run.summary?.totalDeductions)}</span>
                </Field>
              </dl>

              <div className="mt-5 flex flex-wrap gap-3 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                {can('MANAGE_SALARY') && run.status === 'DRAFT' && (
                  <ActionButton onClick={handleProcess} disabled={isActing}>
                    Process
                  </ActionButton>
                )}
                {can('APPROVE_PAYROLL') && run.status === 'PROCESSED' && (
                  <ActionButton
                    onClick={handleFinalize}
                    disabled={isActing || isOwnRun}
                    title={isOwnRun ? 'You prepared this run — finalization requires a different user.' : undefined}
                  >
                    Finalize
                  </ActionButton>
                )}
                {canReview && run.status === 'PROCESSED' && (
                  <ActionButton onClick={handleReject} disabled={isActing} variant="danger">
                    Reject to Draft
                  </ActionButton>
                )}
                {canReview && ['DRAFT', 'PROCESSED'].includes(run.status) && (
                  <ActionButton onClick={handleCancel} disabled={isActing} variant="danger">
                    Cancel Run
                  </ActionButton>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Payslips
              </h3>
              {run.payslips?.length ? (
                <DataTable columns={payslipColumns} rows={run.payslips} />
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No payslips yet — process this run to generate them.
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

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
