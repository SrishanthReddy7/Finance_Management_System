import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
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

export default function MyPayslips() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)

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

  useEffect(() => {
    if (!user?.employee?.id) return
    payrollApi
      .listEmployeePayslips(user.employee.id)
      .then(setRows)
      .catch((err) => setError(unwrapError(err, 'Could not load your payslips.')))
      .finally(() => setIsLoading(false))
  }, [user?.employee?.id])

  const columns = [
    { key: 'period', label: 'Period', render: (row) => `${MONTH_NAMES[row.periodMonth]} ${row.periodYear}` },
    { key: 'grossEarnings', label: 'Gross', align: 'right', render: (row) => <span className="num">{formatCurrency(row.grossEarnings)}</span> },
    { key: 'totalDeductions', label: 'Deductions', align: 'right', render: (row) => <span className="num">{formatCurrency(row.totalDeductions)}</span> },
    { key: 'netSalary', label: 'Net', align: 'right', render: (row) => <span className="num font-semibold">{formatCurrency(row.netSalary)}</span> },
    // Payment date (from the payslip's existing paidAt); shown on the Employee redesign only
    ...(user?.roleType === 'USER' ? [{ key: 'paidAt', label: 'Paid On', render: (row) => (row.paidAt ? formatDate(row.paidAt) : '—') }] : []),
    { key: 'paymentStatus', label: 'Status', render: (row) => <StatusBadge status={row.paymentStatus} entity="paymentStatus" /> },
  ]

  return (
    <AppShell navItems={navItems} title="My Payslips" subtitle="Your payslips by period.">
      <div className="flex flex-col gap-5">
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
            No payslips yet.
          </p>
        ) : (
          <DataTable columns={columns} rows={rows} onRowClick={setViewing} />
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={() => setViewing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="payslip-modal w-full max-w-md rounded-xl border p-6"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {MONTH_NAMES[viewing.periodMonth]} {viewing.periodYear}
              </h2>
              <button type="button" onClick={() => setViewing(null)} aria-label="Close" style={{ color: 'var(--ink-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {viewing.lines?.map((line) => (
                <div key={line.id} className="flex items-center justify-between text-[13px]">
                  <span style={{ color: 'var(--ink-muted)' }}>{line.label}</span>
                  <span className="num" style={{ color: line.type === 'DEDUCTION' ? 'var(--danger)' : 'var(--ink)' }}>
                    {line.type === 'DEDUCTION' ? '−' : ''}
                    {formatCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                Net Salary
              </span>
              <span className="num text-[16px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(viewing.netSalary)}
              </span>
            </div>
            {viewing.paidAt && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                Paid {formatDate(viewing.paidAt)} via {viewing.paymentMethod?.replace(/_/g, ' ')}
                {viewing.paymentReferenceNo ? ` · ${viewing.paymentReferenceNo}` : ''}
              </p>
            )}
            <button
              type="button"
              onClick={() => handleDownload(viewing)}
              disabled={isDownloading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              <Download size={15} />
              {isDownloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  )
}
