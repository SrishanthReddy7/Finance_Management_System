import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  UserCheck,
  Building2,
  Wallet,
  ShieldCheck,
  Banknote,
  ArrowRight,
  BarChart3,
  PieChart as PieIcon,
  UserPlus,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'
import * as payrollApi from '../../api/payroll'
import { formatDate } from '../../utils/format'

const ROLE_COLORS = ['#2563EB', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#6366F1']

function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 ${className}`}
      style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
    >
      {children}
    </div>
  )
}

function IconTile({ icon: Icon, color, bg }) {
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
      style={{ background: bg, color }}
    >
      <Icon size={22} />
    </span>
  )
}

function KpiCard({ icon, color, bg, label, value, sublabel }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color={color} bg={bg} />
        <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {label}
        </div>
      </div>
      <div className="mt-3 whitespace-nowrap text-[26px] font-bold leading-tight text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
        {sublabel}
      </div>
    </Card>
  )
}

function SummaryTile({ icon, color, bg, label, value, sub, to }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconTile icon={icon} color={color} bg={bg} />
          <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {label}
          </div>
        </div>
        <Link
          to={to}
          aria-label={`Open ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition hover:bg-blue-100"
        >
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="mt-3 text-[24px] font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {sub}
      </div>
    </Card>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-lg border bg-white px-3 py-2 text-[12px] shadow-lg"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="mb-1 font-semibold text-slate-900">{label || payload[0]?.name}</div>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color || entry.payload?.fill || '#2563EB' }}
          />
          <span>
            {entry.name}: <strong>{entry.value}</strong>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function HRAdminDashboard() {
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [latestRun, setLatestRun] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      employeesApi.listUsers({ pageSize: 100 }),
      departmentsApi.listDepartments({ includeInactive: true }),
      payrollApi.listRuns({ pageSize: 100 }),
    ])
      .then(([usersRes, deptRes, runsRes]) => {
        if (cancelled) return
        setUsers(usersRes.rows || [])
        setDepartments(deptRes || [])
        const sortedRuns = [...(runsRes.rows || [])].sort(
          (a, b) => b.periodYear - a.periodYear || b.periodMonth - a.periodMonth
        )
        setLatestRun(sortedRuns[0] || null)
      })
      .catch((err) => console.warn('HR Dashboard load error:', err))
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Aggregate stats
  const totalStaff = users.length
  const activeStaff = users.filter((u) => u.status === 'ACTIVE').length
  const totalDepts = departments.length

  // Headcount by Department Data for Bar Chart
  const departmentChartData = useMemo(() => {
    return departments.map((d) => {
      const count = users.filter((u) => u.employee?.departmentId === d.id).length
      return {
        name: d.name,
        headcount: count,
      }
    })
  }, [departments, users])

  // Workforce Role Distribution Data for Pie Chart
  const roleDistributionData = useMemo(() => {
    const roleCounts = {}
    users.forEach((u) => {
      const rName = u.role?.name || u.roleType || 'Employee'
      roleCounts[rName] = (roleCounts[rName] || 0) + 1
    })
    return Object.entries(roleCounts).map(([name, value]) => ({
      name,
      value,
    }))
  }, [users])

  // Recent Joiners
  const recentJoiners = useMemo(() => {
    return [...users]
      .filter((u) => u.employee?.dateOfJoining)
      .sort((a, b) => new Date(b.employee.dateOfJoining) - new Date(a.employee.dateOfJoining))
      .slice(0, 5)
  }, [users])

  return (
    <div className="flex flex-col gap-6">
      {/* ================= TOP 4 KPI CARDS ================= */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          color="#2563EB"
          bg="#EFF6FF"
          label="Total Workforce"
          value={isLoading ? '…' : totalStaff}
          sublabel="Across all organization departments"
        />

        <KpiCard
          icon={UserCheck}
          color="#10B981"
          bg="#ECFDF5"
          label="Active Employees"
          value={isLoading ? '…' : activeStaff}
          sublabel={
            totalStaff > 0
              ? `${((activeStaff / totalStaff) * 100).toFixed(0)}% account active rate`
              : 'Active accounts'
          }
        />

        <KpiCard
          icon={Building2}
          color="#8B5CF6"
          bg="#F5F3FF"
          label="Departments"
          value={isLoading ? '…' : totalDepts}
          sublabel="Active operational divisions"
        />

        <KpiCard
          icon={Wallet}
          color="#F97316"
          bg="#FFF7ED"
          label="Payroll Coverage"
          value={latestRun ? latestRun.status : 'Active'}
          sublabel={
            latestRun
              ? `Cycle ${latestRun.periodMonth}/${latestRun.periodYear}`
              : 'Current monthly cycle'
          }
        />
      </div>

      {/* ================= MIDDLE ROW (2 LARGE CHARTS) ================= */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Headcount by Department */}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconTile icon={BarChart3} color="#2563EB" bg="#EFF6FF" />
              <h3 className="text-[17px] font-bold text-slate-900">Headcount by Department</h3>
            </div>
            <Link
              to="/org-teams"
              className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50"
              style={{ borderColor: 'var(--border)' }}
            >
              View Structure
            </Link>
          </div>

          <div className="h-[260px] w-full pt-2">
            {departmentChartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[13px] text-slate-400">
                No department data available.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departmentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#64748B' }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#64748B' }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="headcount" name="Employees" fill="#2563EB" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Workforce Distribution & Roles */}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconTile icon={PieIcon} color="#8B5CF6" bg="#F5F3FF" />
              <h3 className="text-[17px] font-bold text-slate-900">Workforce Distribution</h3>
            </div>
            <span className="text-[12px] text-slate-400">Current Distribution</span>
          </div>

          <div className="flex h-[260px] w-full flex-col sm:flex-row items-center justify-center">
            {roleDistributionData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[13px] text-slate-400">
                No role distribution data.
              </div>
            ) : (
              <>
                <div className="h-full w-full sm:w-[60%]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={roleDistributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {roleDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={ROLE_COLORS[index % ROLE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-col gap-2.5 sm:w-[40%] pr-4">
                  {roleDistributionData.map((item, idx) => (
                    <div key={item.name} className="flex items-center justify-between text-[13px]">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: ROLE_COLORS[idx % ROLE_COLORS.length] }}
                        />
                        <span className="font-medium text-slate-700">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-900">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ================= LOWER SUMMARY TILES (4 TILES WITH ARROWS) ================= */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={Users}
          color="#2a78d6"
          bg="#EFF6FF"
          label="Staff Directory"
          value={totalStaff}
          sub="View full employee directory"
          to="/employees"
        />

        <SummaryTile
          icon={ShieldCheck}
          color="#8B5CF6"
          bg="#F5F3FF"
          label="HR Operations"
          value="HR Hub"
          sub="Onboard staff & manage access"
          to="/hr-admin"
        />

        <SummaryTile
          icon={Wallet}
          color="#10B981"
          bg="#ECFDF5"
          label="Salary Structures"
          value="Compensation"
          sub="Base, HRA & allowances"
          to="/salary-structures"
        />

        <SummaryTile
          icon={Banknote}
          color="#F97316"
          bg="#FFF7ED"
          label="Payroll Management"
          value={latestRun ? latestRun.status : 'Payroll'}
          sub="Review & finalize pay runs"
          to="/payroll"
        />
      </div>

      {/* ================= RECENT ONBOARDINGS TABLE ================= */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconTile icon={UserPlus} color="#10B981" bg="#ECFDF5" />
            <div>
              <h3 className="text-[17px] font-bold text-slate-900">Recent Onboardings</h3>
              <p className="text-[12px] text-slate-500">Recently registered team members</p>
            </div>
          </div>
          <Link
            to="/hr-admin"
            className="flex items-center gap-1 text-[13px] font-semibold text-blue-600 hover:underline"
          >
            Manage in HR Hub <ChevronRight size={14} />
          </Link>
        </div>

        {recentJoiners.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-slate-400">No recent onboardings recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead
                className="border-b text-[12px] font-semibold uppercase tracking-wider text-slate-500"
                style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
              >
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Employee Code</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Date of Joining</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {recentJoiners.map((emp) => {
                  const name = emp.employee
                    ? `${emp.employee.firstName} ${emp.employee.lastName}`
                    : emp.email
                  const dept =
                    departments.find((d) => d.id === emp.employee?.departmentId)?.name || 'General'
                  return (
                    <tr key={emp.id} className="transition hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div>{name}</div>
                            <div className="text-[11px] text-slate-400">{emp.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-slate-600">
                        {emp.employee?.employeeCode || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{emp.employee?.designation || 'Staff'}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {dept}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDate(emp.employee?.dateOfJoining)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/employees/${emp.employee?.id || emp.id}`}
                          className="inline-flex items-center gap-1 rounded p-1 text-slate-400 hover:text-blue-600"
                        >
                          <ExternalLink size={15} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
