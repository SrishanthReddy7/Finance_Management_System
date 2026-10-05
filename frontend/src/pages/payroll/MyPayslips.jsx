import { useEffect, useState, useMemo } from 'react'
import { Download, X, Eye, Calendar, RotateCcw } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadPayslipPdf } from '../../utils/payslipPdf'

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const STATUS_CHIPS = [
  { label: 'All Statuses', value: '' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Unpaid', value: 'UNPAID' },
  { label: 'Failed', value: 'FAILED' },
]

export default function MyPayslips() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)

  // Filters State
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  // Compute available years dynamically
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const years = new Set([currentYear, currentYear - 1, currentYear - 2])
    rows.forEach((r) => {
      if (r.periodYear) years.add(r.periodYear)
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [rows])

  const activeFiltersCount = (selectedYear ? 1 : 0) + (selectedMonth ? 1 : 0) + (selectedStatus ? 1 : 0)

  function loadPayslips() {
    if (!user?.employee?.id) return
    setIsLoading(true)
    setError('')

    payrollApi
      .listEmployeePayslips(user.employee.id, {
        periodYear: selectedYear || undefined,
        periodMonth: selectedMonth || undefined,
        paymentStatus: selectedStatus || undefined,
      })
      .then(setRows)
      .catch((err) => setError(unwrapError(err, 'Could not load your payslips.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    loadPayslips()
  }, [user?.employee?.id, selectedYear, selectedMonth, selectedStatus])

  function handleResetFilters() {
    setSelectedYear('')
    setSelectedMonth('')
    setSelectedStatus('')
  }

  async function handleDownload(payslip) {
    setIsDownloading(true)
    try {
      await downloadPayslipPdf(payslip)
    } catch {
      setError('Could not generate the PDF.')
    } finally {
      setIsDownloading(false)
    }
  }

  const columns = [
    {
      key: 'period',
      label: 'Period',
      render: (row) => (
        <span className="font-semibold text-slate-900">
          {MONTH_NAMES[row.periodMonth]} {row.periodYear}
        </span>
      ),
    },
    {
      key: 'grossEarnings',
      label: 'Gross',
      align: 'right',
      render: (row) => <span className="num">{formatCurrency(row.grossEarnings)}</span>,
    },
    {
      key: 'totalDeductions',
      label: 'Deductions',
      align: 'right',
      render: (row) => <span className="num text-rose-600">{formatCurrency(row.totalDeductions)}</span>,
    },
    {
      key: 'netSalary',
      label: 'Net Take-Home',
      align: 'right',
      render: (row) => <span className="num font-bold text-slate-900">{formatCurrency(row.netSalary)}</span>,
    },
    ...(user?.roleType === 'USER'
      ? [
          {
            key: 'paidAt',
            label: 'Paid On',
            render: (row) => (row.paidAt ? formatDate(row.paidAt) : '—'),
          },
        ]
      : []),
    {
      key: 'paymentStatus',
      label: 'Status',
      render: (row) => <StatusBadge status={row.paymentStatus} entity="paymentStatus" />,
    },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setViewing(row)
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700 transition hover:bg-blue-100 hover:border-blue-300"
          >
            <Eye size={13} />
            View
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleDownload(row)
            }}
            title="Download Payslip PDF"
            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Download size={14} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="My Payslips"
      subtitle="View, filter and download your monthly remuneration and salary breakdown."
    >
      <div className="flex flex-col gap-4">
        {/* Filter Controls Directly Above Table */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3.5 shadow-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          {/* Status Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_CHIPS.map((chip) => {
              const isActive = selectedStatus === chip.value
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => setSelectedStatus(chip.value)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                    isActive
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>

          {/* Period Filters (Year & Month) */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Year Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-slate-500">Period:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Years</option>
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            {/* Month Selector */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Months</option>
              {FULL_MONTH_NAMES.slice(1).map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>

            {/* Reset Filters */}
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading payslips…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <Calendar size={32} className="text-slate-400" />
            <h4 className="mt-3 text-[15px] font-semibold text-slate-800">No payslips found</h4>
            <p className="mt-1 text-[13px] text-slate-500">
              {activeFiltersCount > 0
                ? 'Try adjusting your period or status filters to view records.'
                : 'No payslips have been issued for this account yet.'}
            </p>
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-100"
              >
                <RotateCcw size={13} />
                Clear Active Filters
              </button>
            )}
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} onRowClick={setViewing} />
        )}
      </div>

      {/* Detailed Payslip View Modal */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(3px)' }}
          onClick={() => setViewing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="payslip-modal w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl"
            style={{ borderColor: 'var(--border)' }}
          >
            {/* Modal Header */}
            <div className="mb-4 flex items-start justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Salary Statement
                </span>
                <h2 className="text-[18px] font-bold text-slate-900">
                  {FULL_MONTH_NAMES[viewing.periodMonth]} {viewing.periodYear}
                </h2>
                <p className="text-[12px] text-slate-500">
                  Ref: {viewing.employee?.employeeCode || user?.employee?.employeeCode || 'EMP'} • {viewing.employee ? `${viewing.employee.firstName} ${viewing.employee.lastName}` : (user?.name || 'Staff')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={viewing.paymentStatus} entity="paymentStatus" />
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  aria-label="Close"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Salary Breakdown Lines */}
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
              <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400">
                Earnings & Allowances
              </div>
              {viewing.lines
                ?.filter((line) => line.type !== 'DEDUCTION')
                .map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-slate-50">
                    <span className="text-slate-600">{line.label}</span>
                    <span className="num font-semibold text-slate-800">
                      {formatCurrency(line.amount)}
                    </span>
                  </div>
                ))}

              <div className="mt-3 text-[12px] font-bold uppercase tracking-wider text-slate-400">
                Statutory & Other Deductions
              </div>
              {viewing.lines
                ?.filter((line) => line.type === 'DEDUCTION')
                .map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-slate-50">
                    <span className="text-slate-600">{line.label}</span>
                    <span className="num font-semibold text-rose-600">
                      −{formatCurrency(line.amount)}
                    </span>
                  </div>
                ))}
            </div>

            {/* Summary Totals */}
            <div className="mt-4 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
              <div className="flex items-center justify-between text-[13px] text-slate-600">
                <span>Gross Remuneration:</span>
                <span className="font-semibold text-slate-800">{formatCurrency(viewing.grossEarnings)}</span>
              </div>
              <div className="flex items-center justify-between text-[13px] text-slate-600 mt-1">
                <span>Total Deductions:</span>
                <span className="font-semibold text-rose-600">−{formatCurrency(viewing.totalDeductions)}</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2 text-[14px]">
                <span className="font-bold text-slate-900">Net Take-Home Salary</span>
                <span className="num text-[18px] font-extrabold text-blue-600">
                  {formatCurrency(viewing.netSalary)}
                </span>
              </div>
            </div>

            {viewing.paidAt && (
              <p className="mt-3 text-[12px] text-slate-500 text-center">
                Disbursed on {formatDate(viewing.paidAt)} via {viewing.paymentMethod?.replace(/_/g, ' ')}
                {viewing.paymentReferenceNo ? ` • Ref #${viewing.paymentReferenceNo}` : ''}
              </p>
            )}

            {/* Download PDF Action */}
            <button
              type="button"
              onClick={() => handleDownload(viewing)}
              disabled={isDownloading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              <Download size={16} />
              {isDownloading ? 'Generating PDF…' : 'Download Payslip (PDF)'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  )
}
