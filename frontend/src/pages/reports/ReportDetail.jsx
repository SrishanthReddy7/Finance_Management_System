import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import KpiRow from '../../components/dashboard/KpiRow'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as reportsApi from '../../api/reports'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

const TITLES = {
  revenue: 'Revenue',
  expenses: 'Expenses',
  'profit-loss': 'Profit & Loss',
  'financial-summary': 'Financial Summary',
  'cash-flow': 'Cash Flow',
  'payment-transactions': 'Payment Transactions',
  'salary-expense': 'Salary Expense',
  'employee-reimbursement': 'Employee Reimbursement',
  'project-profitability': 'Project Profitability',
}

const FETCHERS = {
  revenue: reportsApi.getRevenue,
  expenses: reportsApi.getExpenses,
  'profit-loss': reportsApi.getProfitLoss,
  'financial-summary': reportsApi.getFinancialSummary,
  'cash-flow': reportsApi.getCashFlow,
  'payment-transactions': reportsApi.getPaymentTransactions,
  'salary-expense': reportsApi.getSalaryExpense,
  'employee-reimbursement': reportsApi.getEmployeeReimbursement,
  'project-profitability': reportsApi.getProjectProfitability,
}

const USES_DATE_RANGE = new Set(['revenue', 'expenses', 'profit-loss', 'financial-summary', 'cash-flow', 'payment-transactions', 'employee-reimbursement'])

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}
function toIso(dateOnly) {
  return dateOnly ? new Date(`${dateOnly}T00:00:00.000Z`).toISOString() : undefined
}

export default function ReportDetail() {
  const { key } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(todayDateOnly())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const usesDateRange = USES_DATE_RANGE.has(key)

  function load() {
    const fetcher = FETCHERS[key]
    if (!fetcher) return
    setIsLoading(true)
    setError('')
    const params = usesDateRange ? { from: toIso(from), to: toIso(to) } : {}
    fetcher(params)
      .then(setData)
      .catch((err) => setError(unwrapError(err, 'Could not load this report.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from, to])

  return (
    <AppShell navItems={navItems} title={TITLES[key] || 'Report'} subtitle="Choose a period and review the results.">
      <div className="flex flex-col gap-6">
        <Link to="/reports" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Reports
        </Link>

        {usesDateRange && (
          <div className="report-filters flex items-center gap-3">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              to
            </span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </div>
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
        ) : data ? (
          <ReportBody reportKey={key} data={data} />
        ) : null}
      </div>
    </AppShell>
  )
}

function ReportBody({ reportKey, data }) {
  switch (reportKey) {
    case 'revenue':
      return (
        <>
          <KpiRow stats={[
            { label: 'Invoices', value: String(data.summary?.invoiceCount ?? 0), sublabel: 'In range', sublabelColor: 'muted' },
            { label: 'Total Revenue', value: formatCurrency(data.summary?.totalRevenue), sublabel: 'In range', sublabelColor: 'success' },
          ]} />
          <Section title="By Client">
            <DataTable
              columns={[
                { key: 'name', label: 'Client' },
                { key: 'count', label: 'Invoices', align: 'right', render: (r) => <span className="num">{r.count}</span> },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{formatCurrency(r.total)}</span> },
              ]}
              rows={data.byClient || []}
            />
          </Section>
        </>
      )
    case 'expenses':
      return (
        <>
          <KpiRow stats={[
            { label: 'Claims', value: String(data.summary?.claimCount ?? 0), sublabel: 'In range', sublabelColor: 'muted' },
            { label: 'Total Expense', value: formatCurrency(data.summary?.totalExpense), sublabel: 'In range', sublabelColor: 'warning' },
          ]} />
          <Section title="By Category">
            <DataTable
              columns={[
                { key: 'name', label: 'Category' },
                { key: 'count', label: 'Claims', align: 'right', render: (r) => <span className="num">{r.count}</span> },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{formatCurrency(r.total)}</span> },
              ]}
              rows={data.byCategory || []}
            />
          </Section>
        </>
      )
    case 'profit-loss':
      return (
        <>
          <KpiRow stats={[
            { label: 'Revenue', value: formatCurrency(data.revenue), sublabel: 'In range', sublabelColor: 'success' },
            { label: 'Costs', value: formatCurrency(data.costs?.total), sublabel: 'In range', sublabelColor: 'warning' },
            { label: 'Profit', value: formatCurrency(data.profit), sublabel: `${data.marginPercent ?? 0}% margin`, sublabelColor: data.profit >= 0 ? 'success' : 'danger' },
          ]} />
          <Section title="Breakdown">
            <DataTable
              columns={[
                { key: 'component', label: 'Component' },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num" style={{ color: r.amount < 0 ? 'var(--danger)' : 'var(--ink)' }}>{formatCurrency(r.amount)}</span> },
              ]}
              rows={data.breakdown || []}
            />
          </Section>
        </>
      )
    case 'financial-summary':
      return (
        <>
          <KpiRow stats={[
            { label: 'Revenue', value: formatCurrency(data.revenue), sublabel: 'In range', sublabelColor: 'success' },
            { label: 'Expenses', value: formatCurrency(data.expenses?.total), sublabel: 'In range', sublabelColor: 'warning' },
            { label: 'Profit', value: formatCurrency(data.profit), sublabel: `${data.marginPercent ?? 0}% margin`, sublabelColor: data.profit >= 0 ? 'success' : 'danger' },
            { label: 'Net Cash Flow', value: formatCurrency(data.cashFlow?.netCashFlow), sublabel: 'In range', sublabelColor: 'muted' },
          ]} />
          <div className="grid grid-cols-2 gap-4">
            <MiniCard title="Receivable / Payable">
              <Row label="Receivable" value={formatCurrency(data.receivables?.totalOutstanding)} />
              <Row label="Payable" value={formatCurrency(data.payables?.totalOutstanding)} />
            </MiniCard>
            <MiniCard title="GST">
              <Row label="Net Payable" value={formatCurrency(data.gst?.netPayable)} />
              <Row label="Net Refundable" value={formatCurrency(data.gst?.netRefundable)} />
            </MiniCard>
            <MiniCard title="Budget">
              <Row label="Planned" value={formatCurrency(data.budget?.plannedAmount)} />
              <Row label="Actual" value={formatCurrency(data.budget?.actual)} />
            </MiniCard>
            <MiniCard title="Cash Flow">
              <Row label="Cash In" value={formatCurrency(data.cashFlow?.cashIn)} />
              <Row label="Cash Out" value={formatCurrency(data.cashFlow?.cashOut)} />
            </MiniCard>
          </div>
        </>
      )
    case 'cash-flow':
      return (
        <>
          <KpiRow stats={[
            { label: 'Cash In', value: formatCurrency(data.summary?.cashIn), sublabel: 'In range', sublabelColor: 'success' },
            { label: 'Cash Out', value: formatCurrency(data.summary?.cashOut), sublabel: 'In range', sublabelColor: 'warning' },
            { label: 'Net Cash Flow', value: formatCurrency(data.summary?.netCashFlow), sublabel: 'In range', sublabelColor: data.summary?.netCashFlow >= 0 ? 'success' : 'danger' },
          ]} />
          <Section title="By Month">
            <DataTable
              columns={[
                { key: 'period', label: 'Month' },
                { key: 'cashIn', label: 'Cash In', align: 'right', render: (r) => <span className="num">{formatCurrency(r.cashIn)}</span> },
                { key: 'cashOut', label: 'Cash Out', align: 'right', render: (r) => <span className="num">{formatCurrency(r.cashOut)}</span> },
              ]}
              rows={data.byPeriod || []}
            />
          </Section>
        </>
      )
    case 'payment-transactions':
      return (
        <>
          <KpiRow stats={[
            { label: 'Cash In', value: formatCurrency(data.summary?.totalIn), sublabel: 'In range', sublabelColor: 'success' },
            { label: 'Cash Out', value: formatCurrency(data.summary?.totalOut), sublabel: 'In range', sublabelColor: 'warning' },
            { label: 'Payroll', value: formatCurrency(data.summary?.totalPayroll), sublabel: 'In range', sublabelColor: 'muted' },
            { label: 'Net Movement', value: formatCurrency(data.summary?.netCashMovement), sublabel: 'In range', sublabelColor: 'muted' },
          ]} />
          <Section title="Transactions">
            <DataTable
              columns={[
                { key: 'date', label: 'Date', render: (r) => formatDate(r.date || r.paymentDate) },
                { key: 'direction', label: 'Direction' },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">{formatCurrency(r.amount)}</span> },
              ]}
              rows={data.transactions || []}
            />
          </Section>
        </>
      )
    case 'salary-expense':
      return (
        <>
          <KpiRow stats={[
            { label: 'Employees', value: String(data.summary?.employeeCount ?? 0), sublabel: 'Paid', sublabelColor: 'muted' },
            { label: 'Gross Earnings', value: formatCurrency(data.summary?.grossEarnings), sublabel: 'Total', sublabelColor: 'muted' },
            { label: 'Deductions', value: formatCurrency(data.summary?.totalDeductions), sublabel: 'Total', sublabelColor: 'muted' },
            { label: 'Net Salary', value: formatCurrency(data.summary?.netSalary), sublabel: 'Total', sublabelColor: 'success' },
          ]} />
          <Section title="By Department">
            <DataTable
              columns={[
                { key: 'name', label: 'Department', render: (r) => r.name || 'No department' },
                { key: 'netSalary', label: 'Net Salary', align: 'right', render: (r) => <span className="num">{formatCurrency(r.netSalary)}</span> },
              ]}
              rows={data.byDepartment || []}
            />
          </Section>
        </>
      )
    case 'employee-reimbursement':
      return (
        <>
          <KpiRow stats={[
            { label: 'Reimbursements', value: String(data.summary?.count ?? 0), sublabel: 'In range', sublabelColor: 'muted' },
            { label: 'Total Reimbursed', value: formatCurrency(data.summary?.totalReimbursed), sublabel: 'In range', sublabelColor: 'success' },
            { label: 'Total Pending', value: formatCurrency(data.summary?.totalPending), sublabel: 'In range', sublabelColor: 'warning' },
          ]} />
          <Section title="Reimbursements">
            <DataTable
              columns={[
                { key: 'employee', label: 'Employee', render: (r) => (r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—') },
                { key: 'category', label: 'Category', render: (r) => r.category?.name || '—' },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">{formatCurrency(r.amount)}</span> },
                { key: 'paymentStatus', label: 'Status', render: (r) => r.paymentStatus?.replace(/_/g, ' ') },
              ]}
              rows={data.reimbursements || []}
            />
          </Section>
        </>
      )
    case 'project-profitability': {
      const rows = (data.rows || []).map((p) => ({
        id: p.projectId || p.id,
        name: p.name || p.project?.name,
        revenue: p.revenue?.billed ?? 0,
        cost: p.cost?.total ?? 0,
      }))
      return (
        <Section title="Projects">
          <DataTable
            columns={[
              { key: 'name', label: 'Project' },
              { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="num">{formatCurrency(r.revenue)}</span> },
              { key: 'cost', label: 'Cost', align: 'right', render: (r) => <span className="num">{formatCurrency(r.cost)}</span> },
              {
                key: 'margin',
                label: 'Margin',
                align: 'right',
                render: (r) => {
                  if (!r.revenue) return <span style={{ color: 'var(--ink-faint)' }}>—</span>
                  const margin = ((r.revenue - r.cost) / r.revenue) * 100
                  return (
                    <span className="num font-semibold" style={{ color: margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {margin >= 0 ? '+' : ''}
                      {margin.toFixed(0)}%
                    </span>
                  )
                },
              },
            ]}
            rows={rows}
          />
        </Section>
      )
    }
    default:
      return null
  }
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function MiniCard({ title, children }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        {title}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
      <span className="num font-medium" style={{ color: 'var(--ink)' }}>
        {value}
      </span>
    </div>
  )
}
