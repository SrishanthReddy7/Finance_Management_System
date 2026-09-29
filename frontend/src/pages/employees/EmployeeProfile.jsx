import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import DataTable from '../../components/ui/DataTable'
import SalaryStructurePanel from '../../components/salary/SalaryStructurePanel'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as employeesApi from '../../api/employees'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadPayslipPdf } from '../../utils/payslipPdf'
import EmployeeEditModal from './EmployeeEditModal'

const TABS = ['Profile', 'Salary', 'Payslips', 'Team']

export default function EmployeeProfile() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [employee, setEmployee] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [activeTab, setActiveTab] = useState('Profile')

  function load() {
    setIsLoading(true)
    setError('')
    employeesApi
      .getEmployee(id)
      .then(setEmployee)
      .catch((err) => setError(unwrapError(err, 'Could not load this profile.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const isSelf = user?.employee?.id === id
  const canViewTeam = isSelf || user?.roleType === 'SUPER_ADMIN'
  const tabs = TABS.filter((t) => t !== 'Team' || canViewTeam)
  // A plain Employee cannot open the Directory, so their own profile drops the "Back to Directory" link
  const isEmployeeSelf = isSelf && user?.roleType === 'USER'

  return (
    <AppShell
      navItems={navItems}
      title={isEmployeeSelf ? 'My Profile' : 'Employee Profile'}
      subtitle="Employment details, reporting line and account status."
      topbarActions={
        can('MANAGE_USERS') && employee ? (
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            Edit Profile
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        {!isEmployeeSelf && (
          <Link to="/employees" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
            <ArrowLeft size={15} /> Back to Directory
          </Link>
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
        ) : employee ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  {isEmployeeSelf && (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[20px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {(employee.firstName?.[0] || '?').toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {employee.firstName} {employee.lastName}
                    </h2>
                    <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                      {employee.designation} · {employee.department?.name || 'No department'}
                    </p>
                  </div>
                </div>
                <StatusBadge status={employee.status} entity="employment" />
              </div>

              <dl className="mt-6 grid grid-cols-4 gap-4 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Field label="Employee Code">
                  <span className="num">{employee.employeeCode}</span>
                </Field>
                <Field label="Email">{employee.user?.email || '—'}</Field>
                <Field label="Phone">{employee.phone || '—'}</Field>
                <Field label="Date of Joining">{formatDate(employee.dateOfJoining)}</Field>
                <Field label="Manager">{employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'}</Field>
                <Field label="Account Status">{employee.user?.status || '—'}</Field>
              </dl>
            </div>

            <div className="page-tabs flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-current={activeTab === tab ? 'page' : undefined}
                  onClick={() => setActiveTab(tab)}
                  className="pb-2.5 text-[13px] font-medium"
                  style={{
                    borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                    marginBottom: '-1px',
                    color: activeTab === tab ? 'var(--accent)' : 'var(--ink-muted)',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'Profile' && (
              <p className="profile-note text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                {employee.firstName} joined on {formatDate(employee.dateOfJoining)} as {employee.designation}.
              </p>
            )}
            {activeTab === 'Salary' && <SalaryStructurePanel employeeId={id} />}
            {activeTab === 'Payslips' && <PayslipsTab employeeId={id} />}
            {activeTab === 'Team' && <TeamTab employeeId={id} />}
          </>
        ) : null}
      </div>

      {showEdit && employee && (
        <EmployeeEditModal
          employee={employee}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
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

function PayslipsTab({ employeeId }) {
  const [rows, setRows] = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    payrollApi
      .listEmployeePayslips(employeeId)
      .then(setRows)
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true)
      })
  }, [employeeId])

  if (notFound) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
        Payslip information is not available to you for this employee.
      </p>
    )
  }
  if (rows === null) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Loading…
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
        No payslips yet.
      </p>
    )
  }

  const columns = [
    { key: 'period', label: 'Period', render: (row) => `${row.periodMonth}/${row.periodYear}` },
    { key: 'grossEarnings', label: 'Gross', align: 'right', render: (row) => <span className="num">{formatCurrency(row.grossEarnings)}</span> },
    { key: 'totalDeductions', label: 'Deductions', align: 'right', render: (row) => <span className="num">{formatCurrency(row.totalDeductions)}</span> },
    { key: 'netSalary', label: 'Net', align: 'right', render: (row) => <span className="num font-semibold">{formatCurrency(row.netSalary)}</span> },
    { key: 'paymentStatus', label: 'Status', render: (row) => <StatusBadge status={row.paymentStatus} entity="paymentStatus" /> },
    {
      key: 'pdf',
      label: '',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => downloadPayslipPdf(row)}
          aria-label={`Download payslip ${row.periodMonth}/${row.periodYear}`}
          className="inline-flex items-center gap-1 text-[12px] font-medium"
          style={{ color: 'var(--accent)' }}
        >
          <Download size={14} /> PDF
        </button>
      ),
    },
  ]

  return <DataTable columns={columns} rows={rows} />
}

function TeamTab({ employeeId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    employeesApi
      .getSubordinates(employeeId)
      .then(setRows)
      .catch((err) => setError(unwrapError(err, 'Could not load this team.')))
  }, [employeeId])

  if (error) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
        {error}
      </p>
    )
  }
  if (rows === null) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Loading…
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
        No one reports to this person.
      </p>
    )
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {rows.map((row) => (
        <Link
          key={row.id}
          to={`/employees/${row.id}`}
          className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <div style={{ color: 'var(--ink)' }}>
              {row.firstName} {row.lastName}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {row.designation} · {row.department?.name || 'No department'}
            </div>
          </div>
          <StatusBadge status={row.status} entity="employment" />
        </Link>
      ))}
    </div>
  )
}
