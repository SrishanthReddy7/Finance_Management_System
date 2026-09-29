import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BellRing, ClipboardCheck, FileBarChart, FileText, Landmark, PiggyBank, Receipt, ReceiptText, Send, Wallet } from 'lucide-react'
import { Card, EmptyPanel, KpiCard, SectionHeader } from '../../components/dashboard/DashCards'
import { useAuth } from '../../context/AuthContext'
import * as expensesApi from '../../api/expenses'
import * as invoicesApi from '../../api/invoices'
import * as vendorBillsApi from '../../api/vendorBills'
import * as payoutsApi from '../../api/payouts'
import * as gstApi from '../../api/gst'
import * as budgetsApi from '../../api/budgets'
import * as reportsApi from '../../api/reports'
import { formatCurrency, formatDate } from '../../utils/format'

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

export default function FinanceAdminDashboard() {
  const { user } = useAuth()
  const [financeQueueRows, setFinanceQueueRows] = useState([])
  const [invoiceApprovalCount, setInvoiceApprovalCount] = useState(null)
  const [billApprovalCount, setBillApprovalCount] = useState(null)
  const [payoutApprovalCount, setPayoutApprovalCount] = useState(null)
  const [outstanding, setOutstanding] = useState(null)
  const [payable, setPayable] = useState(null)
  const [paymentReport, setPaymentReport] = useState(null)
  const [gstReadyCount, setGstReadyCount] = useState(null)
  const [gstSummary, setGstSummary] = useState(null)
  const [budgetAlerts, setBudgetAlerts] = useState([])
  const [paymentTransactions, setPaymentTransactions] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      expensesApi.listClaims({ status: 'MANAGER_APPROVED', pageSize: 100 }),
      invoicesApi.listInvoices({ status: 'PENDING_APPROVAL', pageSize: 100 }),
      invoicesApi.getOutstandingReport(),
      invoicesApi.getClientPaymentReport({ from: firstOfMonth(), to: todayDateOnly() }),
      vendorBillsApi.listVendorBills({ status: 'PENDING_APPROVAL', pageSize: 100 }).catch(() => ({ rows: [] })),
      payoutsApi.listPayouts({ status: 'AWAITING_APPROVAL', pageSize: 100 }).catch(() => ({ rows: [] })),
      vendorBillsApi.getPayableReport().catch(() => null),
      gstApi.listPeriods({ status: 'READY', pageSize: 50 }).catch(() => ({ rows: [] })),
      gstApi.getSummary({ from: firstOfMonth(), to: todayDateOnly() }).catch(() => null),
      budgetsApi.listBudgets({ status: 'ACTIVE', pageSize: 50 }).catch(() => ({ rows: [] })),
      reportsApi.getPaymentTransactions({ from: `${firstOfMonth()}T00:00:00.000Z`, to: `${todayDateOnly()}T23:59:59.999Z` }).catch(() => null),
    ])
      .then(async ([expenseRes, invoiceRes, outstandingRes, paymentRes, billRes, payoutRes, payableRes, gstReadyRes, gstSummaryRes, budgetsRes, paymentTxRes]) => {
        if (cancelled) return
        setFinanceQueueRows(expenseRes.rows.filter((row) => row.employeeId !== user?.employee?.id))
        setInvoiceApprovalCount(invoiceRes.rows.filter((row) => row.createdById !== user?.id).length)
        setBillApprovalCount(billRes.rows.filter((row) => row.createdById !== user?.id).length)
        setPayoutApprovalCount(payoutRes.rows.filter((row) => row.initiatedById !== user?.id).length)
        setOutstanding(outstandingRes)
        setPayable(payableRes)
        setPaymentReport(paymentRes)
        setGstReadyCount(gstReadyRes.rows.length)
        setGstSummary(gstSummaryRes)
        setPaymentTransactions(paymentTxRes)

        const withUtilization = await Promise.all(
          budgetsRes.rows.slice(0, 5).map((b) => budgetsApi.getUtilization(b.id).catch(() => null))
        )
        if (!cancelled) {
          setBudgetAlerts(
            withUtilization
              .filter((u) => u && u.utilizationPercent != null && u.utilizationPercent >= 80)
              .sort((a, b) => b.utilizationPercent - a.utilizationPercent)
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.employee?.id, user?.id])

  const recentPayments = paymentReport?.payments?.slice(0, 3) || []

  const actions = [
    { label: 'Expense Claims to Approve', count: financeQueueRows.length, to: '/expenses/approvals', icon: ClipboardCheck, color: '#1D5FE8', bg: '#EAF1FF' },
    { label: 'Invoices Pending Approval', count: invoiceApprovalCount, to: '/invoices', icon: FileText, color: '#7C3AED', bg: '#F1EBFE' },
    { label: 'Vendor Bills to Approve', count: billApprovalCount, to: '/vendor-bills', icon: Landmark, color: '#EA580C', bg: '#FFF0E3' },
    { label: 'Payouts to Approve', count: payoutApprovalCount, to: '/payouts', icon: Send, color: '#0E9F8E', bg: '#E2F7F4' },
    { label: 'GST Filings Ready', count: gstReadyCount, to: '/gst', icon: FileBarChart, color: '#16A34A', bg: '#E8F8EE' },
  ]
  const overdueAr = outstanding?.summary?.overdueCount ?? 0
  const overdueAp = payable?.summary?.overdueCount ?? 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-bold sm:text-[28px]">Finance Overview</h2>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          A summary of the organization&apos;s cash flow, receivables, payables, approvals and GST this month.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ArrowDownLeft} color="#16A34A" bg="#E8F8EE" label="Cash In (MTD)" value={formatCurrency(paymentReport?.summary?.totalReceived ?? 0)} sublabel="Client payments received" sublabelColor="var(--success)" to="/invoices/payments" />
        <KpiCard icon={ArrowUpRight} color="#EA580C" bg="#FFF0E3" label="Cash Out (MTD)" value={formatCurrency(paymentTransactions?.summary?.totalOut ?? 0)} sublabel="Vendors + payroll + refunds" sublabelColor="var(--warning)" to="/reports" />
        <KpiCard icon={Receipt} color="#1D5FE8" bg="#EAF1FF" label="Accounts Receivable" value={formatCurrency(outstanding?.summary?.totalOutstanding ?? 0)} sublabel={`${overdueAr} overdue`} sublabelColor={overdueAr ? 'var(--danger)' : 'var(--ink-muted)'} to="/invoices" />
        <KpiCard icon={Wallet} color="#7C3AED" bg="#F1EBFE" label="Accounts Payable" value={formatCurrency(payable?.summary?.totalOutstanding ?? 0)} sublabel={`${overdueAp} overdue`} sublabelColor={overdueAp ? 'var(--danger)' : 'var(--ink-muted)'} to="/vendor-bills" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader icon={BellRing} title="Needs Your Action" />
          <div className="flex flex-col">
            {actions.map((a) => (
              <Link key={a.label} to={a.to} className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: a.bg, color: a.color }}>
                    <a.icon size={18} />
                  </span>
                  <span className="truncate text-[14px] font-semibold">{a.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="num min-w-[2rem] rounded-full px-2.5 py-0.5 text-center text-[13px] font-bold" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                    {isLoading ? '…' : a.count}
                  </span>
                  <ArrowRight size={16} color="var(--ink-faint)" />
                </span>
              </Link>
            ))}
          </div>
          {/* "Refunds to Approve" was dropped: INITIATE_REFUND/APPROVE_REFUND
              exist as permission codes, but no refund workflow endpoint was
              ever built anywhere in the 8-step plan -- keeping a queue row
              pointing nowhere real would misrepresent the app. */}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <SectionHeader icon={FileBarChart} title="GST Summary" to="/gst" />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Output GST (MTD)', value: gstSummary?.summary?.output?.totalTax },
                { label: 'Input GST (MTD)', value: gstSummary?.summary?.inputTaxCredit },
                { label: 'Net Payable (MTD)', value: gstSummary?.summary?.net?.payable, strong: true },
              ].map((m) => (
                <div key={m.label} className="rounded-2xl px-4 py-3" style={{ background: m.strong ? 'var(--accent-soft)' : '#F6F9FF' }}>
                  <div className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    {m.label}
                  </div>
                  <div className="num mt-1 whitespace-nowrap text-[18px] font-bold" style={{ color: m.strong ? 'var(--accent)' : 'var(--ink)' }}>
                    {formatCurrency(m.value ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader icon={PiggyBank} title="Budget Alerts" to="/budgets" />
            {budgetAlerts.length === 0 ? (
              isLoading ? (
                <p className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  Loading…
                </p>
              ) : (
                <EmptyPanel icon={PiggyBank} title="No budget alerts" hint="No active budgets at 80% utilization or above." />
              )
            ) : (
              <div className="flex flex-col">
                {budgetAlerts.map((b) => (
                  <Link key={b.budgetId} to="/budgets" className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <span className="min-w-0 truncate text-[14px] font-semibold">{b.name}</span>
                    <span
                      className="num shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-bold"
                      style={b.utilizationPercent >= 100 ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--warning-soft)', color: 'var(--warning)' }}
                    >
                      {b.utilizationPercent}%
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <SectionHeader icon={ReceiptText} title="Recent Transactions" to="/invoices/payments" />
        {/* Client payments (step 5). A unified all-directions feed now
            exists via Reports > Payment Transactions -- kept this widget to
            client payments only to match its "Recent Transactions" framing
            rather than dumping every direction into a small dashboard card. */}
        {recentPayments.length === 0 ? (
          isLoading ? (
            <p className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Loading…
            </p>
          ) : (
            <EmptyPanel icon={ReceiptText} title="No transactions yet" hint="No client payments recorded this month." />
          )
        ) : (
          <div className="flex flex-col">
            {recentPayments.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">Payment received — {tx.invoice?.client?.name}</div>
                  <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {formatDate(tx.paymentDate)} · {tx.invoice?.invoiceNumber}
                  </div>
                </div>
                <span className="num shrink-0 text-[14px] font-bold" style={{ color: 'var(--success)' }}>
                  +{formatCurrency(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

