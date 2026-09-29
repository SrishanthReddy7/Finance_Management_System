import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Processed', value: 'PROCESSED' },
  { label: 'Finalized', value: 'FINALIZED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PAGE_SIZE = 20

export default function PayrollRunsList() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    payrollApi
      .listRuns({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE })
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
  }, [statusFilter, page])

  const columns = [
    { key: 'period', label: 'Period', render: (row) => `${MONTH_NAMES[row.periodMonth]} ${row.periodYear}` },
    { key: 'employeeCount', label: 'Employees', align: 'right', render: (row) => <span className="num">{row.summary?.employeeCount ?? 0}</span> },
    { key: 'totalNet', label: 'Total Net', align: 'right', render: (row) => <span className="num">{formatCurrency(row.summary?.totalNet)}</span> },
    { key: 'paidCount', label: 'Paid', align: 'right', render: (row) => <span className="num">{row.summary?.paidCount ?? 0} / {row.summary?.employeeCount ?? 0}</span> },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="payrollRun" /> },
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
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Run
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => {
                setPage(1)
                setStatusFilter(chip.value)
              }}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
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

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            No payroll runs found.
          </p>
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
