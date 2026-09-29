import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock, FileText, Users } from 'lucide-react'
import { Card, EmptyPanel, KpiCard, SectionHeader } from '../../components/dashboard/DashCards'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { useTeamExpenseSummary } from './useTeamExpenseSummary'
import * as employeesApi from '../../api/employees'
import { formatCurrency, formatDate } from '../../utils/format'

export default function TeamLeadDashboard() {
  const { user } = useAuth()
  const { isLoading, error, pendingApprovalRows, awaitingPaymentCount, thisMonthTotal } = useTeamExpenseSummary(user)
  const [team, setTeam] = useState([])

  useEffect(() => {
    if (!user?.employee?.id) return
    employeesApi.getSubordinates(user.employee.id).then(setTeam).catch(() => setTeam([]))
  }, [user?.employee?.id])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-bold sm:text-[28px]">Team Overview</h2>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          Here&apos;s a summary of your team&apos;s expenses and approvals.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FileText} color="#1D5FE8" bg="#EAF1FF" label="My Team's Expenses" value={formatCurrency(thisMonthTotal)} sublabel="This month" to="/reports/employee-reimbursement" />
        <KpiCard icon={Clock} color="#7C3AED" bg="#F1EBFE" label="Pending Your Approval" value={String(pendingApprovalRows.length)} sublabel="Awaiting review" sublabelColor="var(--warning)" to="/expenses/approvals" />
        <KpiCard icon={Users} color="#EA580C" bg="#FFF0E3" label="Team Headcount" value={String(team.length)} sublabel="Direct + indirect reports" to="/org-teams" />
        <KpiCard icon={CheckCircle2} color="#16A34A" bg="#E8F8EE" label="Approved, Awaiting Payment" value={String(awaitingPaymentCount)} sublabel="With Finance" sublabelColor="var(--success)" to="/expenses/approvals" />
      </div>

      <Card>
        <SectionHeader icon={FileText} title="Pending Expense Approvals" to="/expenses/approvals" />
        {isLoading ? (
          <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : pendingApprovalRows.length === 0 ? (
          <EmptyPanel icon={FileText} title="No pending expense approvals" hint="Nothing is waiting on your review." />
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
    </div>
  )
}
