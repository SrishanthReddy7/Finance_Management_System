import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, RotateCcw } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
import CreatePayrollRunModal from './CreatePayrollRunModal'

const STATUS_CHIPS = [
  { label: 'All Statuses', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Processed', value: 'PROCESSED' },
  { label: 'Finalized', value: 'FINALIZED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const PAGE_SIZE = 20

export default function PayrollRunsList() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [periodYear, setPeriodYear] = useState('')
  const [periodMonth, setPeriodMonth] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const availableYears = useMemo(() => {
    const cur = new Date().getFullYear()
    return [cur + 1, cur, cur - 1, cur - 2, cur - 3]
  }, [])

  function load() {
    setIsLoading(true)
    setError('')
    payrollApi
      .listRuns({
        status: statusFilter || undefined,
        periodYear: periodYear || undefined,
        periodMonth: periodMonth || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => setError(unwrapError(err, 'Could not load payroll runs.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, periodYear, periodMonth, page])

  const columns = [
    { key: 'period', label: 'Period', render: (row) => <span className="font-semibold text-slate-900">{MONTH_NAMES[row.periodMonth]} {row.periodYear}</span> },
    { key: 'employeeCount', label: 'Employees', align: 'right', render: (row) => <span className="num">{row.summary?.employeeCount ?? 0}</span> },
    { key: 'totalNet', label: 'Total Net', align: 'right', render: (row) => <span className="num font-semibold text-slate-900">{formatCurrency(row.summary?.totalNet)}</span> },
    { key: 'paidCount', label: 'Paid', align: 'right', render: (row) => <span className="num">{row.summary?.paidCount ?? 0} / {row.summary?.employeeCount ?? 0}</span> },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="payrollRun" /> },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/payroll/${row.id}`)
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <Eye size={13} />
          View
        </button>
      ),
    },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="Payroll"
      subtitle="Monthly payroll runs and their processing status."
      topbarActions={
        can('MANAGE_SALARY') && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110"
            style={{ background: 'var(--accent)' }}
          >
            New Run
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {/* Filter Bar with Period and Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3.5 shadow-sm" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Chips */}
            {STATUS_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => {
                  setPage(1)
                  setStatusFilter(chip.value)
                }}
                className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: statusFilter === chip.value ? 'var(--accent)' : 'var(--border)',
                  background: statusFilter === chip.value ? 'var(--accent-soft)' : 'var(--surface)',
                  color: statusFilter === chip.value ? 'var(--accent)' : 'var(--ink-muted)',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Period Filters */}
          <div className="flex items-center gap-2">
            <select
              value={periodYear}
              onChange={(e) => {
                setPage(1)
                setPeriodYear(e.target.value)
              }}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>

            <select
              value={periodMonth}
              onChange={(e) => {
                setPage(1)
                setPeriodMonth(e.target.value)
              }}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Months</option>
              {FULL_MONTH_NAMES.slice(1).map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>

            {(statusFilter || periodYear || periodMonth) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('')
                  setPeriodYear('')
                  setPeriodMonth('')
                  setPage(1)
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
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
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <p className="text-[14px] font-medium text-slate-700">No payroll runs found.</p>
            <p className="mt-1 text-[12px] text-slate-400">Try adjusting your status or period filters.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(row) => navigate(`/payroll/${row.id}`)}
            page={meta?.page}
            pageSize={meta?.pageSize}
            totalCount={meta?.totalCount}
            onPageChange={setPage}
          />
        )}
      </div>

      {showCreate && (
        <CreatePayrollRunModal
          onClose={() => setShowCreate(false)}
          onSaved={(run) => {
            setShowCreate(false)
            navigate(`/payroll/${run.id}`)
          }}
        />
      )}
    </AppShell>
  )
}
