import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Building2,
  Wallet,
  ShieldCheck,
  UserPlus,
  Search,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  UserCheck,
  BadgeCheck,
} from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'
import { unwrapError } from '../../api/unwrap'
import CreateEmployeeModal from '../employees/CreateEmployeeModal'

export default function HRAdminPage() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [activeTab, setActiveTab] = useState('STAFF') // 'STAFF' | 'DEPARTMENTS' | 'COMPENSATION' | 'PERMISSIONS'
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [actionSuccess, setActionSuccess] = useState('')

  // Load employee directory and departments
  function loadData() {
    setIsLoading(true)
    setError('')
    Promise.all([
      employeesApi.listUsers({ pageSize: 100 }),
      departmentsApi.listDepartments({ includeInactive: true }),
    ])
      .then(([usersData, deptsData]) => {
        setEmployees(usersData.rows || [])
        setDepartments(deptsData || [])
      })
      .catch((err) => {
        setError(unwrapError(err, 'Failed to load HR management data.'))
      })
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  // Quick action: Toggle user status
  async function handleToggleStatus(targetUser) {
    if (targetUser.id === user?.id) {
      alert('You cannot modify your own account status.')
      return
    }

    const nextStatus = targetUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const confirmMsg = `Are you sure you want to ${nextStatus === 'ACTIVE' ? 'activate' : 'deactivate'} the account for ${targetUser.employee?.firstName || targetUser.email}?`
    if (!window.confirm(confirmMsg)) return

    setError('')
    try {
      await employeesApi.setUserStatus(targetUser.id, nextStatus)
      setActionSuccess(`Account for ${targetUser.email} has been updated to ${nextStatus}.`)
      setTimeout(() => setActionSuccess(''), 4000)
      loadData()
    } catch (err) {
      setError(unwrapError(err, 'Could not update user status.'))
    }
  }

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const q = searchQuery.toLowerCase().trim()
      const fullName = `${emp.employee?.firstName || ''} ${emp.employee?.lastName || ''}`.toLowerCase()
      const email = (emp.email || '').toLowerCase()
      const code = (emp.employee?.employeeCode || '').toLowerCase()
      const designation = (emp.employee?.designation || '').toLowerCase()
      const matchesSearch = !q || fullName.includes(q) || email.includes(q) || code.includes(q) || designation.includes(q)

      const matchesDept = !deptFilter || emp.employee?.departmentId === deptFilter
      const matchesStatus = !statusFilter || emp.status === statusFilter

      return matchesSearch && matchesDept && matchesStatus
    })
  }, [employees, searchQuery, deptFilter, statusFilter])

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const totalStaff = employees.length
    const activeStaff = employees.filter((e) => e.status === 'ACTIVE').length
    const pendingStaff = employees.filter((e) => e.status === 'PENDING').length
    const deptsCount = departments.length
    return { totalStaff, activeStaff, pendingStaff, deptsCount }
  }, [employees, departments])

  // Strict role separation: HR Admin role only
  const isHRAdmin = user?.roleName === 'HR Admin' || user?.role?.name === 'HR Admin'

  if (!isHRAdmin) {
    return (
      <AppShell
        navItems={navItems}
        title="Access Restricted"
        subtitle="This portal is strictly reserved for the HR Administrator."
      >
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <ShieldCheck size={28} />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">HR Administrator Access Only</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            The HR Administration Portal is strictly exclusive to the HR Admin role.
          </p>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Return to Dashboard
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      navItems={navItems}
      title="HR Administration Portal"
      subtitle="Role-based workforce governance, employee onboarding, department structure, and compensation oversight."
      topbarActions={
        <div className="flex items-center gap-2">
          {isHRAdmin && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110"
              style={{ background: 'var(--accent)' }}
            >
              <UserPlus size={16} />
              Onboard Staff
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Success Banner */}
        {actionSuccess && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
            <AlertCircle size={18} className="text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* HR KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            className="flex items-center gap-4 rounded-xl border p-4 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Users size={24} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-slate-500 uppercase tracking-wider">Total Workforce</p>
              <h3 className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>
                {metrics.totalStaff}
              </h3>
            </div>
          </div>

          <div
            className="flex items-center gap-4 rounded-xl border p-4 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <UserCheck size={24} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-slate-500 uppercase tracking-wider">Active Employees</p>
              <h3 className="text-2xl font-bold text-emerald-600">
                {metrics.activeStaff}
              </h3>
            </div>
          </div>

          <div
            className="flex items-center gap-4 rounded-xl border p-4 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Building2 size={24} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-slate-500 uppercase tracking-wider">Departments</p>
              <h3 className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>
                {metrics.deptsCount}
              </h3>
            </div>
          </div>

          <div
            className="flex items-center gap-4 rounded-xl border p-4 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <ShieldCheck size={24} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-slate-500 uppercase tracking-wider">HR Access Level</p>
              <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
                {user?.roleName || user?.roleType || 'HR Admin'}
              </h3>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('STAFF')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
              activeTab === 'STAFF'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users size={16} />
            Staff Directory ({filteredEmployees.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('DEPARTMENTS')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
              activeTab === 'DEPARTMENTS'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Building2 size={16} />
            Department Structure
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('COMPENSATION')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
              activeTab === 'COMPENSATION'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Wallet size={16} />
            Salary & Compensation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('PERMISSIONS')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
              activeTab === 'PERMISSIONS'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <BadgeCheck size={16} />
            HR Role & RBAC Matrix
          </button>
        </div>

        {/* TAB 1: STAFF DIRECTORY */}
        {activeTab === 'STAFF' && (
          <div className="flex flex-col gap-4">
            {/* Filter Bar */}
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex flex-1 flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name, email, code, designation..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-[13px] focus:border-blue-500 focus:outline-none"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>

                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-[13px] focus:outline-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-[13px] focus:outline-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="">All Account Statuses</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>

              {(searchQuery || deptFilter || statusFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setDeptFilter('')
                    setStatusFilter('')
                  }}
                  className="text-[12px] font-medium text-blue-600 hover:underline"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {/* Staff Table */}
            <div
              className="overflow-hidden rounded-xl border shadow-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              {isLoading ? (
                <div className="py-16 text-center text-[13px] text-slate-500">
                  Loading employee records…
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-[14px] font-semibold text-slate-700">No employees found</p>
                  <p className="mt-1 text-[13px] text-slate-400">
                    Try adjusting your search criteria or onboard a new employee.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead
                      className="border-b text-[12px] font-semibold text-slate-500 uppercase tracking-wider"
                      style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
                    >
                      <tr>
                        <th className="px-4 py-3.5">Staff Member</th>
                        <th className="px-4 py-3.5">Employee Code</th>
                        <th className="px-4 py-3.5">Designation</th>
                        <th className="px-4 py-3.5">Department</th>
                        <th className="px-4 py-3.5">System Role</th>
                        <th className="px-4 py-3.5">Status</th>
                        <th className="px-4 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {filteredEmployees.map((emp) => {
                        const name = emp.employee
                          ? `${emp.employee.firstName} ${emp.employee.lastName}`
                          : emp.email
                        const dept = departments.find((d) => d.id === emp.employee?.departmentId)?.name || '—'
                        const isSelf = emp.id === user?.id

                        return (
                          <tr key={emp.id} className="transition hover:bg-slate-50/70">
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                                  {name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-900">{name}</p>
                                  <p className="text-[12px] text-slate-500">{emp.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 font-mono text-[12px] text-slate-600">
                              {emp.employee?.employeeCode || '—'}
                            </td>
                            <td className="px-4 py-3.5 text-slate-700">
                              {emp.employee?.designation || 'Staff'}
                            </td>
                            <td className="px-4 py-3.5 text-slate-700">
                              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                <Building2 size={11} /> {dept}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                {emp.role?.name || emp.roleType}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <StatusBadge status={emp.status} />
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/employees/${emp.employee?.id || emp.id}`)}
                                  className="rounded p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                  title="View Employee Profile"
                                >
                                  <ExternalLink size={15} />
                                </button>
                                {!isSelf && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStatus(emp)}
                                    className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                                      emp.status === 'ACTIVE'
                                        ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                    }`}
                                  >
                                    {emp.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: DEPARTMENTS */}
        {activeTab === 'DEPARTMENTS' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((dept) => {
              const staffInDept = employees.filter((e) => e.employee?.departmentId === dept.id)
              return (
                <div
                  key={dept.id}
                  className="flex flex-col justify-between rounded-xl border p-5 shadow-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                        <Building2 size={20} />
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          dept.isActive !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {dept.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>
                    <h3 className="mt-4 text-[16px] font-bold text-slate-900">{dept.name}</h3>
                    <p className="mt-1 text-[13px] text-slate-500">
                      {staffInDept.length} member{staffInDept.length === 1 ? '' : 's'} assigned
                    </p>
                  </div>

                  <div className="mt-5 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setDeptFilter(dept.id)
                        setActiveTab('STAFF')
                      }}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:underline"
                    >
                      View Department Members <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* TAB 3: SALARY & COMPENSATION */}
        {activeTab === 'COMPENSATION' && (
          <div
            className="rounded-xl border p-6 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h3 className="text-[16px] font-bold text-slate-900">Compensation & Salary Oversight</h3>
                <p className="text-[13px] text-slate-500">
                  Manage compensation profiles, salary breakdown (Base, HRA, Allowances, PF), and payroll readiness.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/salary-structures')}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white shadow-sm"
                style={{ background: 'var(--accent)' }}
              >
                <Wallet size={16} /> Open Salary Structures Page
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                <p className="text-[12px] font-semibold uppercase text-slate-500">Salary Management Rights</p>
                <p className="mt-2 text-[13px] text-slate-700">
                  HR Admins hold the <span className="font-mono font-bold text-blue-600">MANAGE_SALARY</span> permission, granting full authority to define and adjust salary structures across employees.
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                <p className="text-[12px] font-semibold uppercase text-slate-500">Company-Wide Salary Visibility</p>
                <p className="mt-2 text-[13px] text-slate-700">
                  With <span className="font-mono font-bold text-blue-600">VIEW_COMPANY_SALARY</span>, HR Admins oversee remuneration metrics while maintaining audit compliance.
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                <p className="text-[12px] font-semibold uppercase text-slate-500">Payroll Alignment</p>
                <p className="mt-2 text-[13px] text-slate-700">
                  Ensure all onboarded staff have approved compensation models before the monthly payroll run cutoff.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: HR ROLE & RBAC MATRIX */}
        {activeTab === 'PERMISSIONS' && (
          <div
            className="rounded-xl border p-6 shadow-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-[16px] font-bold text-slate-900">HR Admin Role-Based Access Control (RBAC)</h3>
            <p className="mt-1 text-[13px] text-slate-500">
              The HR Admin role is calibrated specifically for organizational talent management and employee governance.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-center gap-2 font-semibold text-blue-900">
                  <BadgeCheck size={18} className="text-blue-600" />
                  <span>Assigned Permissions for HR Admin</span>
                </div>
                <ul className="mt-3 space-y-2 text-[13px] text-blue-800">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span className="font-mono font-bold">CREATE_EMPLOYEE</span>: Onboard new workforce members
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span className="font-mono font-bold">MANAGE_USERS</span>: Activate, deactivate, and edit employee accounts
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span className="font-mono font-bold">VIEW_EMPLOYEE</span>: Access complete employee profiles & reporting chains
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span className="font-mono font-bold">MANAGE_SALARY</span>: Create and update employee compensation packages
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span className="font-mono font-bold">VIEW_COMPANY_SALARY</span>: View salary structures across all departments
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <ShieldCheck size={18} className="text-slate-600" />
                  <span>Separation of Concerns & Safeguards</span>
                </div>
                <p className="mt-3 text-[13px] text-slate-600 leading-relaxed">
                  Financial money-movement permissions (such as final invoice approval, vendor payments, and payout disbursements) remain strictly isolated with <strong>Finance Admin</strong> and <strong>Super Admin</strong>, ensuring regulatory compliance and dual-control maker-checker integrity.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Onboard Employee Modal */}
      {showCreateModal && (
        <CreateEmployeeModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false)
            setActionSuccess('New employee onboarded successfully!')
            setTimeout(() => setActionSuccess(''), 4000)
            loadData()
          }}
        />
      )}
    </AppShell>
  )
}
