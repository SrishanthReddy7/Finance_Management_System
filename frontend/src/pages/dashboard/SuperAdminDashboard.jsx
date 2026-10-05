import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, BarChart3, Briefcase, Clock, FileText, Landmark, PieChart as PieIcon,
  Percent, TrendingUp, Users, Wallet,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ProgressBar from '../../components/ui/ProgressBar'
import StatusBadge from '../../components/ui/StatusBadge'
import * as projectsApi from '../../api/projects'
import * as invoicesApi from '../../api/invoices'
import * as vendorBillsApi from '../../api/vendorBills'
import * as gstApi from '../../api/gst'
import * as budgetsApi from '../../api/budgets'
import * as reportsApi from '../../api/reports'
import * as auditApi from '../../api/audit'
import { formatCurrency, formatDate } from '../../utils/format'

// Every figure here comes from the existing reporting APIs. Cash In vs Cash
// Out uses /reports/cash-flow; the distribution donut uses the real cost
// components of /reports/financial-summary (claims, vendor bills, payroll).

const CASH_IN = '#2a78d6'
const CASH_OUT = '#f0793a'
const RANGE_OPTIONS = [
  { label: 'Last 3 Months', months: 3 },
  { label: 'Last 6 Months', months: 6 },
  { label: 'Last 12 Months', months: 12 },
]
const SLICES = [
  { key: 'payroll', label: 'Salaries (Payroll)', color: '#2563EB' },
  { key: 'vendorBills', label: 'Vendor Bills', color: '#7C3AED' },
  { key: 'expenses', label: 'Employee Expenses', color: '#38BDF8' },
]

const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const compactINR = (v) => {
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  return formatCurrency(n)
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}
function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function timeAgo(value) {
  const secs = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}
function titleCase(s) {
  return String(s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}
// % change vs the previous period; null when there is nothing to compare with
function pctChange(current, previous) {
  const prev = Number(previous)
  if (!Number.isFinite(prev) || prev === 0) return null
  return ((Number(current) - prev) / Math.abs(prev)) * 100
}

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

function CardHeader({ icon, color, bg, title, right }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color={color} bg={bg} />
        <h3 className="text-[17px] font-bold">{title}</h3>
      </div>
      {right}
    </div>
  )
}

function KpiCard({ icon, color, bg, label, value, change, higherIsBetter = true }) {
  const good = change == null ? null : higherIsBetter ? change >= 0 : change <= 0
  return (
    <Card>
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color={color} bg={bg} />
        <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {label}
        </div>
      </div>
      {/* Whole rupees keep the figure on one line at laptop widths; hover shows the exact amount */}
      <div className="mt-3 whitespace-nowrap text-[26px] font-bold leading-tight" title={formatCurrency(value)}>
        {wholeRupees.format(Number(value) || 0)}
      </div>
      {change == null ? (
        <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          No prior period to compare
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-[12px] font-semibold" style={{ color: good ? 'var(--success)' : 'var(--danger)' }}>
          {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(change).toFixed(1)}%
          <span className="font-normal" style={{ color: 'var(--ink-muted)' }}>
            vs last month
          </span>
        </div>
      )}
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
        <Link to={to} aria-label={`Open ${label}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100">
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="mt-3 text-[24px] font-bold">{value}</div>
      <div className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {sub}
      </div>
    </Card>
  )
}

function ViewAll({ to }) {
  return (
    <Link to={to} className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold hover:bg-blue-50" style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}>
      View All
    </Link>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-[12px] shadow-lg" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}: {formatCurrency(entry.value)}
        </div>
      ))}
    </div>
  )
}

export default function SuperAdminDashboard() {
  const [months, setMonths] = useState(6)
  const [outstanding, setOutstanding] = useState(null)
  const [payable, setPayable] = useState(null)
  const [projectRows, setProjectRows] = useState(null)
  const [projectCount, setProjectCount] = useState(null)
  const [financialSummary, setFinancialSummary] = useState(null)
  const [cashFlow, setCashFlow] = useState(null)
  const [gstSummary, setGstSummary] = useState(null)
  const [gstPeriods, setGstPeriods] = useState([])
  const [budgetRows, setBudgetRows] = useState([])
  const [recentInvoices, setRecentInvoices] = useState(null)
  const [activities, setActivities] = useState(null)

  useEffect(() => {
    let cancelled = false
    const ok = (setter) => (data) => {
      if (!cancelled) setter(data)
    }
    invoicesApi.getOutstandingReport().then(ok(setOutstanding)).catch(() => {})
    vendorBillsApi.getPayableReport().then(ok(setPayable)).catch(() => {})
    reportsApi.getFinancialSummary({ compare: true }).then(ok(setFinancialSummary)).catch(() => {})
    gstApi.getSummary({ from: firstOfMonth(), to: todayDateOnly() }).then(ok(setGstSummary)).catch(() => {})
    gstApi.listPeriods({ pageSize: 1 }).then(({ rows }) => ok(setGstPeriods)(rows)).catch(() => {})
    invoicesApi.listInvoices({ pageSize: 5 }).then(({ rows }) => ok(setRecentInvoices)(rows)).catch(() => ok(setRecentInvoices)([]))
    auditApi.listAuditLogs({ pageSize: 6 }).then(({ rows }) => ok(setActivities)(rows)).catch(() => ok(setActivities)([]))
    budgetsApi
      .listBudgets({ status: 'ACTIVE', pageSize: 5 })
      .then(async ({ rows }) => {
        const withUtilization = await Promise.all(rows.map((b) => budgetsApi.getUtilization(b.id).catch(() => null)))
        if (!cancelled) setBudgetRows(withUtilization.filter(Boolean))
      })
      .catch(() => {})
    // A handful of active projects' real profitability -- Super Admin can
    // read any project's via the VIEW_FINANCIAL_REPORTS bypass.
    projectsApi
      .listProjects({ status: 'ACTIVE', pageSize: 5 })
      .then(async ({ rows, meta }) => {
        if (!cancelled) setProjectCount(meta?.totalCount ?? rows.length)
        const withProfitability = await Promise.all(
          rows.map((p) =>
            projectsApi
              .getProjectProfitability(p.id)
              .then((prof) => ({ id: p.id, name: p.name, revenue: prof.revenue.billed, cost: prof.cost.total }))
              .catch(() => null)
          )
        )
        if (!cancelled) setProjectRows(withProfitability.filter(Boolean))
      })
      .catch(() => {
        if (!cancelled) setProjectRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const from = new Date()
    from.setMonth(from.getMonth() - (months - 1))
    from.setDate(1)
    reportsApi
      .getCashFlow({ from: from.toISOString().slice(0, 10), to: todayDateOnly() })
      .then((data) => {
        if (!cancelled) setCashFlow(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [months])

  const fs = financialSummary
  const cmp = fs?.comparison
  const cashFlowChartData = (cashFlow?.byPeriod || []).map((p) => ({ month: p.period, cashIn: p.cashIn, cashOut: p.cashOut }))
  const costs = fs?.expenses
  const pieData = costs ? SLICES.map((s) => ({ ...s, value: Number(costs[s.key]) || 0 })).filter((s) => s.value > 0) : []
  const pieTotal = pieData.reduce((sum, s) => sum + s.value, 0)
  const latestGstPeriod = gstPeriods[0]

  return (
    <div className="flex flex-col gap-5">
      {/* KPIs */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={BarChart3} color="#2563EB" bg="#EFF6FF" label="Revenue (MTD)" value={fs?.revenue ?? 0} change={cmp ? pctChange(fs.revenue, cmp.revenue) : null} />
        <KpiCard icon={Wallet} color="#7C3AED" bg="#F1EBFE" label="Expenses (MTD)" value={costs?.total ?? 0} change={cmp ? pctChange(costs?.total, cmp.expenses) : null} higherIsBetter={false} />
        <KpiCard icon={TrendingUp} color="#16A34A" bg="#E8F8EE" label="Profit (MTD)" value={fs?.profit ?? 0} change={cmp ? pctChange(fs.profit, cmp.profit) : null} />
        <KpiCard icon={Banknote} color="#EA580C" bg="#FFF0E3" label="Net Cash Flow (MTD)" value={fs?.cashFlow?.netCashFlow ?? 0} change={null} />
      </div>

      {/* Charts */}
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            icon={BarChart3}
            color="#2563EB"
            bg="#EFF6FF"
            title="Cash In vs Cash Out"
            right={
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-3 text-[12px] sm:flex" style={{ color: 'var(--ink-muted)' }}>
                  <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: CASH_IN }} /> Cash In</span>
                  <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: CASH_OUT }} /> Cash Out</span>
                </span>
                <select
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="rounded-lg border bg-white px-2.5 py-1.5 text-[12px]"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Chart range"
                >
                  {RANGE_OPTIONS.map((o) => (
                    <option key={o.months} value={o.months}>{o.label}</option>
                  ))}
                </select>
              </div>
            }
          />
          {cashFlowChartData.length === 0 ? (
            <p className="py-16 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No cash movement in this range yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cashFlowChartData} barGap={4} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F4F8FF' }} />
                <Bar dataKey="cashIn" name="Cash In" fill={CASH_IN} radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="cashOut" name="Cash Out" fill={CASH_OUT} radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader icon={PieIcon} color="#2563EB" bg="#EFF6FF" title="Expense Distribution" right={<span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>This month</span>} />
          {pieTotal === 0 ? (
            <p className="py-16 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No expenses recorded this month.</p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="relative h-[190px] w-[190px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={58} outerRadius={90} paddingAngle={2} stroke="none">
                      {pieData.map((s) => (
                        <Cell key={s.key} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[18px] font-bold">{compactINR(pieTotal)}</div>
                  <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>Total</div>
                </div>
              </div>
              <ul className="w-full space-y-2.5 text-[13px]">
                {pieData.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
                    <span className="font-semibold">{Math.round((s.value / pieTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* AR / AP / GST / Projects */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          icon={Users} color="#2563EB" bg="#EFF6FF" label="Accounts Receivable" to="/invoices"
          value={wholeRupees.format(outstanding?.summary?.totalOutstanding ?? 0)}
          sub={`${outstanding?.summary?.invoiceCount ?? 0} open invoice${outstanding?.summary?.invoiceCount === 1 ? '' : 's'}`}
        />
        <SummaryTile
          icon={Landmark} color="#7C3AED" bg="#F1EBFE" label="Accounts Payable" to="/vendor-bills"
          value={wholeRupees.format(payable?.summary?.totalOutstanding ?? 0)}
          sub={`Overdue: ${formatCurrency(payable?.summary?.overdueOutstanding ?? 0)}`}
        />
        <SummaryTile
          icon={Percent} color="#2563EB" bg="#EFF6FF" label="Net GST Payable (MTD)" to="/gst"
          value={wholeRupees.format(gstSummary?.summary?.net?.payable ?? 0)}
          sub={latestGstPeriod ? <span className="flex items-center gap-2">Latest period <StatusBadge status={latestGstPeriod.status} entity="gstFiling" /></span> : 'No filing periods yet'}
        />
        <SummaryTile
          icon={Briefcase} color="#EA580C" bg="#FFF0E3" label="Active Projects" to="/projects"
          value={projectCount ?? '—'}
          sub="Currently active"
        />
      </div>

      {/* Recent invoices + activities */}
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader icon={FileText} color="#2563EB" bg="#EFF6FF" title="Recent Invoices" right={<ViewAll to="/invoices" />} />
          {recentInvoices === null ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          ) : recentInvoices.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)', background: '#F4F8FF' }}>
                    {['Invoice #', 'Client', 'Amount', 'Status', 'Date'].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-3"><Link to={`/invoices/${inv.id}`} className="num font-medium hover:underline" style={{ color: 'var(--accent)' }}>{inv.invoiceNumber}</Link></td>
                      <td className="px-3 py-3">{inv.client?.name || '—'}</td>
                      <td className="num px-3 py-3">{formatCurrency(inv.totalAmount)}</td>
                      <td className="px-3 py-3"><StatusBadge status={inv.status} entity="invoice" /></td>
                      <td className="px-3 py-3" style={{ color: 'var(--ink-muted)' }}>{formatDate(inv.invoiceDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader icon={Clock} color="#2563EB" bg="#EFF6FF" title="Recent Activities" right={<ViewAll to="/audit-logs" />} />
          {activities === null ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          ) : activities.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No recent activity.</p>
          ) : (
            <ul className="space-y-3.5">
              {activities.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{titleCase(a.entityType)} · {titleCase(a.action)}</div>
                    <div className="truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>{a.note || a.performedBy?.email || '—'}</div>
                  </div>
                  <span className="shrink-0 text-[12px]" style={{ color: 'var(--ink-faint)' }}>{timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Budget utilization + project profitability (kept from the previous dashboard) */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Wallet} color="#16A34A" bg="#E8F8EE" title="Budget Utilization" right={<ViewAll to="/budgets" />} />
          {budgetRows.length === 0 ? (
            <p className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No active budgets yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {budgetRows.map((b) => (
                <div key={b.budgetId}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate">{b.name}</span>
                    <span className="num shrink-0" style={{ color: 'var(--ink-muted)' }}>{formatCurrency(b.actual)} / {formatCurrency(b.plannedAmount)}</span>
                  </div>
                  <ProgressBar value={b.actual} max={b.plannedAmount} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={Briefcase} color="#EA580C" bg="#FFF0E3" title="Project Profitability" right={<ViewAll to="/projects" />} />
          {projectRows === null ? (
            <p className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          ) : projectRows.length === 0 ? (
            <p className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>No active projects yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)', background: '#F4F8FF' }}>
                    <th className="px-3 py-2.5 font-semibold">Project</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.map((row) => {
                    const margin = row.revenue ? ((row.revenue - row.cost) / row.revenue) * 100 : null
                    return (
                      <tr key={row.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-3">{row.name}</td>
                        <td className="num px-3 py-3 text-right">{formatCurrency(row.revenue)}</td>
                        <td className="num px-3 py-3 text-right">{formatCurrency(row.cost)}</td>
                        <td className="num px-3 py-3 text-right font-semibold" style={{ color: margin == null ? 'var(--ink-faint)' : margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {margin == null ? '—' : `${margin >= 0 ? '+' : ''}${margin.toFixed(0)}%`}
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
    </div>
  )
}
