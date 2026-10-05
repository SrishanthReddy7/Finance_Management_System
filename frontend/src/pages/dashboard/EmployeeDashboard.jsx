import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, Clock, FileSpreadsheet, Plus, Receipt, Wallet } from 'lucide-react'
import { Card, EmptyPanel, KpiCard, SectionHeader } from '../../components/dashboard/DashCards'
import StatusBadge from '../../components/ui/StatusBadge'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import * as expensesApi from '../../api/expenses'
import * as payrollApi from '../../api/payroll'
import { computeExpenseStats } from '../../utils/expenseStats'
import { formatCurrency, formatDate } from '../../utils/format'

const STEPPER_STEPS = ['Submitted', 'Manager Approved', 'Finance Approved', 'Paid']

// Positions the most recent claim's status (+ where it stalled, from its
// approval history) on the shared Submitted -> ... -> Paid stepper. Returns
// null for statuses that don't belong on this stepper (Draft/Cancelled).
function stepperPropsFor(claim, approvalHistory) {
  const lastStep = approvalHistory?.[approvalHistory.length - 1]

  switch (claim.status) {
    case 'SUBMITTED':
      return { steps: STEPPER_STEPS, currentIndex: 0 }
    case 'MANAGER_APPROVED':
      return { steps: STEPPER_STEPS, currentIndex: 1 }
    case 'FINANCE_APPROVED':
    case 'REIMBURSEMENT_PENDING':
    case 'PARTIALLY_PAID':
      return { steps: STEPPER_STEPS, currentIndex: 2 }
    case 'PAID':
      return { steps: STEPPER_STEPS, currentIndex: 3 }
    case 'MANAGER_REJECTED':
      return { steps: STEPPER_STEPS, currentIndex: 0, warningIndex: 1 }
    case 'FINANCE_REJECTED':
      return { steps: STEPPER_STEPS, currentIndex: 1, warningIndex: 2 }
    case 'RETURNED':
      // Which step it stalled at depends on who returned it -- read that
      // off the last approval-history transition rather than guessing.
      return lastStep?.fromStatus === 'MANAGER_APPROVED'
        ? { steps: STEPPER_STEPS, currentIndex: 1, warningIndex: 2 }
        : { steps: STEPPER_STEPS, currentIndex: 0, warningIndex: 1 }
    default:
      return null
  }
}

export default function EmployeeDashboard({ user }) {
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [stepper, setStepper] = useState(null)
  const [payslips, setPayslips] = useState([])

  useEffect(() => {
    let cancelled = false
    expensesApi
      .listClaims({ pageSize: 100 })
      .then(async ({ rows: fetched }) => {
        if (cancelled) return
        const own = fetched.filter((row) => row.employeeId === user?.employee?.id)
        setRows(own)

        const mostRecent = own[0]
        if (mostRecent) {
          const detail = await expensesApi.getClaim(mostRecent.id)
          if (!cancelled) setStepper(stepperPropsFor(detail, detail.approvalHistory))
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.employee?.id])

  useEffect(() => {
    if (!user?.employee?.id) return
    let cancelled = false
    payrollApi
      .listEmployeePayslips(user.employee.id)
      .then((data) => {
        if (!cancelled) setPayslips(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.employee?.id])

  const { pendingCount, approvedTotal, reimbursedTotal } = computeExpenseStats(rows)
  const recentClaims = rows.slice(0, 5)

  const year = new Date().getFullYear()
  const latestPayslip = payslips[0]
  const payslipStatus = latestPayslip?.paymentStatus ? latestPayslip.paymentStatus.charAt(0) + latestPayslip.paymentStatus.slice(1).toLowerCase().replace(/_/g, ' ') : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold sm:text-[28px]">Welcome back, {user?.employee?.firstName}</h2>
          <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            Here&apos;s a quick overview for your expenses, payroll and recent activity.
          </p>
        </div>
        <Link to="/expenses/new" className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={16} /> Submit New Expense
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          color="#2563EB"
          bg="#EFF6FF"
          label="Net Salary (Latest Payslip)"
          value={formatCurrency(latestPayslip?.netSalary ?? 0)}
          sublabel={latestPayslip ? `${latestPayslip.periodMonth}/${latestPayslip.periodYear}${payslipStatus ? ` · ${payslipStatus}` : ''}` : 'No payslips yet'}
          to="/my-payslips"
        />
        <KpiCard icon={Clock} color="#D97706" bg="#FFF4E0" label="Pending Claims" value={String(pendingCount)} sublabel="Awaiting a decision" sublabelColor="var(--warning)" to="/expenses" />
        <KpiCard icon={CheckCircle2} color="#16A34A" bg="#E8F8EE" label="Approved YTD" value={formatCurrency(approvedTotal)} sublabel={`${year}`} sublabelColor="var(--success)" to="/expenses" />
        <KpiCard icon={Banknote} color="#7C3AED" bg="#F1EBFE" label="Reimbursed YTD" value={formatCurrency(reimbursedTotal)} sublabel={`${year}`} to="/expenses" />
      </div>

      {stepper && (
        <Card>
          <h3 className="mb-4 text-[17px] font-bold">Most Recent Claim</h3>
          <WorkflowStepper {...stepper} />
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader icon={Receipt} title="Recent Claims" to="/expenses" />
          {isLoading ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Loading…
            </p>
          ) : recentClaims.length === 0 ? (
            <div>
              <EmptyPanel icon={Receipt} title="No expense claims yet" hint="Claims you submit will appear here." />
              <div className="mt-4 flex justify-center">
                <Link to="/expenses/new" className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
                  <Plus size={16} /> Submit New Expense
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {recentClaims.map((claim) => (
                <Link key={claim.id} to="/expenses" className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">{claim.purpose}</div>
                    <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {claim.category?.name || '—'} · {formatDate(claim.expenseDate)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num text-[14px] font-bold">{formatCurrency(claim.amount)}</span>
                    <StatusBadge status={claim.status} entity="expense" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader icon={FileSpreadsheet} title="My Payslips" to="/my-payslips" />
          {payslips.length === 0 ? (
            <EmptyPanel icon={FileSpreadsheet} title="No payslips yet" hint="Your payslips will appear here once payroll is processed." />
          ) : (
            <div className="flex flex-col">
              {payslips.slice(0, 3).map((p) => (
                <Link key={p.id} to="/my-payslips" className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[14px] font-semibold">
                    {p.periodMonth}/{p.periodYear}
                  </span>
                  <span className="num text-[14px] font-bold">{formatCurrency(p.netSalary)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
