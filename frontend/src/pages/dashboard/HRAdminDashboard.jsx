import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import KpiRow from '../../components/dashboard/KpiRow'
import WorkflowStepper from '../../components/ui/WorkflowStepper'
import ProgressBar from '../../components/ui/ProgressBar'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'
import * as payrollApi from '../../api/payroll'
import { formatDate } from '../../utils/format'

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

function isThisMonth(dateString) {
  const d = new Date(dateString)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export default function HRAdminDashboard() {
  const [users, setUsers] = useState([])
  const [totalHeadcount, setTotalHeadcount] = useState(null)
  const [departments, setDepartments] = useState([])
  const [latestRun, setLatestRun] = useState(null)
  const [activeRunCount, setActiveRunCount] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      employeesApi.listUsers({ pageSize: 100 }),
      departmentsApi.listDepartments(),
      payrollApi.listRuns({ pageSize: 100 }),
    ])
      .then(([usersRes, deptRes, runsRes]) => {
        if (cancelled) return
        setUsers(usersRes.rows)
        setTotalHeadcount(usersRes.meta.totalCount)
        setDepartments(deptRes)
        const sortedRuns = [...runsRes.rows].sort((a, b) => b.periodYear - a.periodYear || b.periodMonth - a.periodMonth)
        setLatestRun(sortedRuns[0] || null)
        setActiveRunCount(runsRes.rows.filter((r) => !['PAID', 'CANCELLED'].includes(r.status)).length)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const employeesWithDates = users.filter((u) => u.employee?.dateOfJoining)
  const newJoinersMtd = employeesWithDates.filter((u) => isThisMonth(u.employee.dateOfJoining)).length
  const recentJoiners = [...employeesWithDates]
    .sort((a, b) => new Date(b.employee.dateOfJoining) - new Date(a.employee.dateOfJoining))
    .slice(0, 5)

  const stepperIndex = latestRun ? stepperIndexFor(latestRun.status) : null

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        HR Overview
      </h2>

      <KpiRow
        stats={[
          { label: 'Total Headcount', value: isLoading ? '…' : String(totalHeadcount ?? 0), sublabel: 'Across the company', sublabelColor: 'muted' },
          { label: 'New Joiners (MTD)', value: isLoading ? '…' : String(newJoinersMtd), sublabel: 'This month', sublabelColor: 'success' },
          { label: 'Active Payroll Runs', value: isLoading ? '…' : String(activeRunCount ?? 0), sublabel: 'Not yet Paid/Cancelled', sublabelColor: 'warning' },
          {
            label: 'Payroll Status',
            value: latestRun ? latestRun.status.charAt(0) + latestRun.status.slice(1).toLowerCase() : 'No runs yet',
            sublabel: latestRun ? `${MONTH_NAMES[latestRun.periodMonth]} ${latestRun.periodYear}` : '',
            sublabelColor: 'muted',
          },
        ]}
      />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
            {latestRun ? `Payroll Run — ${MONTH_NAMES[latestRun.periodMonth]} ${latestRun.periodYear}` : 'Payroll Run'}
          </h3>
          <Link to="/payroll" className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
            View all →
          </Link>
        </div>
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {stepperIndex !== null ? (
            <WorkflowStepper steps={STEPPER_STEPS} currentIndex={stepperIndex} />
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              No payroll runs yet.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
            Recent Joiners
          </h3>
          <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {recentJoiners.length === 0 ? (
              <p className="p-4 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                {isLoading ? 'Loading…' : 'No joiners recorded.'}
              </p>
            ) : (
              recentJoiners.map((u) => (
                <Link
                  key={u.id}
                  to={`/employees/${u.employee.id}`}
                  className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div>
                    <div style={{ color: 'var(--ink)' }}>
                      {u.employee.firstName} {u.employee.lastName}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {u.employee.designation}
                    </div>
                  </div>
                  <span className="num text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    Joined {formatDate(u.employee.dateOfJoining)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
            Department Headcount
          </h3>
          <div className="flex flex-col gap-4 rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {departments.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                {isLoading ? 'Loading…' : 'No departments yet.'}
              </p>
            ) : (
              departments.map((d) => (
                <div key={d.id}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span style={{ color: 'var(--ink)' }}>{d.name}</span>
                    <span className="num" style={{ color: 'var(--ink-muted)' }}>
                      {d._count?.employees ?? 0} of {totalHeadcount ?? 0}
                    </span>
                  </div>
                  <ProgressBar value={d._count?.employees ?? 0} max={totalHeadcount || 1} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
