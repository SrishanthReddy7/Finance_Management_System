import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as gstApi from '../../api/gst'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
import CreateGstPeriodModal from './CreateGstPeriodModal'

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function GstFilings() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [summary, setSummary] = useState(null)
  const [periods, setPeriods] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    Promise.all([gstApi.getSummary(), gstApi.listPeriods({ pageSize: 24 })])
      .then(([summaryRes, periodsRes]) => {
        setSummary(summaryRes)
        setPeriods(periodsRes.rows)
      })
      .catch((err) => setError(unwrapError(err, 'Could not load GST data.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <AppShell
      navItems={navItems}
      title="GST & Filings"

      subtitle="GST filing periods and their status."
      topbarActions={
        can('PREPARE_GST_FILING') && (
          <button type="button" onClick={() => setShowCreate(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            New Period
          </button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <PageTabs tabs={[{ label: 'Periods', href: '/gst' }, { label: 'Transactions', href: '/gst/transactions' }]} />

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <SummaryCard label="Output Tax" value={summary?.summary?.output?.totalTax} />
              <SummaryCard label="Input Tax Credit" value={summary?.summary?.inputTaxCredit} />
              <SummaryCard
                label="Net Payable"
                value={summary?.summary?.net?.payable}
                emphasize
                negative={summary?.summary?.net?.refundable > 0}
                negativeLabel={summary?.summary?.net?.refundable ? `${formatCurrency(summary.summary.net.refundable)} refundable` : null}
              />
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Filing Periods
              </h3>
              {periods.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  No GST periods yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {periods.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/gst/periods/${p.id}`)}
                      className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-shadow hover:shadow-sm"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                          {MONTH_NAMES[p.periodMonth]} {p.periodYear}
                        </span>
                        <StatusBadge status={p.status} entity="gstFiling" />
                      </div>
                      <div className="num text-[18px] font-bold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(p.totals?.payable)}
                      </div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        {p.totals?.transactionCount ?? 0} transactions
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <CreateGstPeriodModal
          onClose={() => setShowCreate(false)}
          onSaved={(period) => {
            setShowCreate(false)
            navigate(`/gst/periods/${period.id}`)
          }}
        />
      )}
    </AppShell>
  )
}

function SummaryCard({ label, value, emphasize, negative, negativeLabel }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className={`num mt-2 font-bold ${emphasize ? 'text-[22px]' : 'text-[18px]'}`} style={{ color: negative ? 'var(--success)' : 'var(--ink)' }}>
        {formatCurrency(value ?? 0)}
      </div>
      {negativeLabel && (
        <div className="num mt-1 text-[12px]" style={{ color: 'var(--success)' }}>
          {negativeLabel}
        </div>
      )}
    </div>
  )
}
