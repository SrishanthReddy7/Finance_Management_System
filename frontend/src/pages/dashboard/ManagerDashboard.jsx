import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BarChart3, Clock, FileText, PieChart, TrendingUp, Users } from 'lucide-react'
import ProgressBar from '../../components/ui/ProgressBar'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { useTeamExpenseSummary } from './useTeamExpenseSummary'
import * as employeesApi from '../../api/employees'
import * as budgetsApi from '../../api/budgets'
import { formatCurrency, formatDate } from '../../utils/format'

const QUICK_REPORTS = [
  { label: 'Team Expense Summary', href: '/reports/employee-reimbursement' },
  { label: 'Project Profitability', href: '/reports/project-profitability' },
  { label: 'Budget Utilization', href: '/budgets' },
]

function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 ${className}`} style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      {children}
    </div>
  )
}

function IconTile({ icon: Icon, color, bg }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: bg, color }}>
      <Icon size={22} />
    </span>
  )
}

function SectionHeader({ icon, title, to }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color="#1D5FE8" bg="#EAF1FF" />
        <h3 className="text-[17px] font-bold">{title}</h3>
      </div>
      {to && (
        <Link to={to} className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
          View all <ArrowRight size={14} />
        </Link>
      )}
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center rounded-2xl px-4 py-6 text-center" style={{ background: '#F6F9FF' }}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: '#E4ECFB', color: '#5B7BB8' }}>
        <Icon size={24} />
      </span>
      <div className="mt-3 text-[15px] font-semibold">{title}</div>
      <div className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </div>
    </div>
  )
}

function KpiCard({ icon, color, bg, label, value, sublabel, sublabelColor = 'var(--ink-muted)', to }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconTile icon={icon} color={color} bg={bg} />
          <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {label}
          </div>
        </div>
        <Link to={to} aria-label={`Open ${label}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100">
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="mt-3 whitespace-nowrap text-[28px] font-bold leading-tight">{value}</div>
      <div className="mt-1 text-[13px]" style={{ color: sublabelColor }}>
        {sublabel}
      </div>
    </Card>
  )
}

export default function ManagerDashboard() {
  const { user } = useAuth()
  const { isLoading, error, pendingApprovalRows, thisMonthTotal } = useTeamExpenseSummary(user)
  const [team, setTeam] = useState([])
  const [projectBudgets, setProjectBudgets] = useState([])

  useEffect(() => {
    if (!user?.employee?.id) return
    employeesApi.getSubordinates(user.employee.id).then(setTeam).catch(() => setTeam([]))
  }, [user?.employee?.id])

  useEffect(() => {
    // In-service scoped: a Manager with no VIEW_FINANCIAL_REPORTS/
    // MANAGE_BUDGETS only ever gets back PROJECT-scope budgets for projects
    // they're the assigned PM of -- exactly what this widget wants.
    budgetsApi
      .listBudgets({ status: 'ACTIVE', pageSize: 10 })
      .then(async ({ rows }) => {
        const withUtilization = await Promise.all(rows.map((b) => budgetsApi.getUtilization(b.id).catch(() => null)))
        setProjectBudgets(withUtilization.filter(Boolean))
      })
      .catch(() => setProjectBudgets([]))
  }, [])

  const avgUtilization = projectBudgets.length
    ? projectBudgets.reduce((sum, p) => sum + (p.utilizationPercent ?? 0), 0) / projectBudgets.length / 100
    : 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-bold sm:text-[28px]">Manager Overview</h2>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          Here&apos;s a summary of your team, projects and key metrics.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FileText} color="#1D5FE8" bg="#EAF1FF" label="Team Expenses" value={formatCurrency(thisMonthTotal)} sublabel="This month" to="/reports/employee-reimbursement" />
        <KpiCard icon={Clock} color="#7C3AED" bg="#F1EBFE" label="Pending Approvals" value={String(pendingApprovalRows.length)} sublabel="Awaiting review" sublabelColor="var(--warning)" to="/expenses/approvals" />
        <KpiCard
          icon={TrendingUp} color="#16A34A" bg="#E8F8EE" label="Avg Project Budget Utilization"
          value={projectBudgets.length ? `${Math.round(avgUtilization * 100)}%` : '—'}
          sublabel={projectBudgets.length ? `${projectBudgets.length} active budget(s)` : 'No budgets assigned'}
          to="/budgets"
        />
        <KpiCard icon={Users} color="#EA580C" bg="#FFF0E3" label="Team Headcount" value={String(team.length)} sublabel="Direct + indirect reports" to="/org-teams" />
      </div>

      <Card>
        <SectionHeader icon={FileText} title="Pending Expense Approvals" to="/expenses/approvals" />
        {isLoading ? (
          <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : pendingApprovalRows.length === 0 ? (
          <EmptyPanel icon={FileText} title="No pending expense approvals" hint="All expense claims are up to date." />
        ) : (
          <div className="flex flex-col">
            {pendingApprovalRows.slice(0, 3).map((claim) => (
              <Link key={claim.id} to="/expenses/approvals" className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">
                    {claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName}` : '—'} · <span className="num">{formatCurrency(claim.amount)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {claim.category?.name} · {claim.purpose} · {formatDate(claim.updatedAt)}
                  </div>
                </div>
                <ArrowRight size={16} color="var(--ink-faint)" className="shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader icon={PieChart} title="Project Budgets" to="/budgets" />
        {projectBudgets.length === 0 ? (
          <EmptyPanel icon={BarChart3} title="No active budgets for your projects" hint="Once budgets are assigned, they will appear here." />
        ) : (
          <div className="flex flex-col gap-4">
            {projectBudgets.map((p) => (
              <div key={p.budgetId}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate">{p.name}</span>
                  <span className="num shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {formatCurrency(p.actual)} / {formatCurrency(p.plannedAmount)}
                  </span>
                </div>
                <ProgressBar value={p.actual} max={p.plannedAmount} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader icon={Users} title="My Team" to="/org-teams" />
          {team.length === 0 ? (
            <EmptyPanel icon={Users} title="No one reports to you yet" hint="Team members who report to you will appear here." />
          ) : (
            <div className="flex flex-col">
              {team.slice(0, 5).map((member) => (
                <Link key={member.id} to={`/employees/${member.id}`} className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {(member.firstName?.[0] || '?').toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold">
                        {member.firstName} {member.lastName}
                      </div>
                      <div className="truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        {member.designation}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={member.status} entity="employment" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader icon={BarChart3} title="Quick Reports" />
          <div className="flex flex-col gap-2">
            {QUICK_REPORTS.map((report) => (
              <Link key={report.label} to={report.href} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-[14px] font-semibold hover:bg-blue-50" style={{ borderColor: 'var(--border)' }}>
                <span className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: '#EAF1FF', color: '#1D5FE8' }}>
                    <FileText size={16} />
                  </span>
                  {report.label}
                </span>
                <ArrowRight size={16} color="var(--accent)" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
