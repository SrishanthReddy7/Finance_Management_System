import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import KpiRow from '../../components/dashboard/KpiRow'
import DataTable from '../../components/ui/DataTable'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as invoicesApi from '../../api/invoices'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'

export default function ClientPaymentsLedger() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    invoicesApi
      .getClientPaymentReport({ from: from || undefined, to: to || undefined })
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load the payments ledger.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const columns = [
    { key: 'paymentDate', label: 'Date', render: (row) => formatDate(row.paymentDate) },
    { key: 'invoiceNumber', label: 'Invoice #', render: (row) => <span className="num">{row.invoice?.invoiceNumber}</span> },
    { key: 'client', label: 'Client', render: (row) => row.invoice?.client?.name || '—' },
    { key: 'amount', label: 'Amount', align: 'right', render: (row) => <span className="num">{formatCurrency(row.amount)}</span> },
    { key: 'method', label: 'Method', render: (row) => row.method.replace(/_/g, ' ') },
    { key: 'referenceNo', label: 'Reference', render: (row) => row.referenceNo || '—' },
  ]

  return (
    <AppShell navItems={navItems} title="Invoices & Payments" subtitle="Every client payment received, across all invoices.">
      <div className="flex flex-col gap-5">
        <PageTabs tabs={[{ label: 'Invoices', href: '/invoices' }, { label: 'Client Payments', href: '/invoices/payments' }]} />

        <KpiRow
          stats={[
            { label: 'Payments', value: String(report?.summary?.paymentCount ?? 0), sublabel: 'In this range', sublabelColor: 'muted' },
            {
              label: 'Total Received',
              value: formatCurrency(report?.summary?.totalReceived ?? 0),
              sublabel: 'In this range',
              sublabelColor: 'success',
            },
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="num ml-2 rounded-lg border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </label>
          <label className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="num ml-2 rounded-lg border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </label>
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
        ) : !report?.payments?.length ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            No payments in this range.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={report.payments}
            onRowClick={(row) => navigate(`/invoices/${row.invoice.id}`)}
          />
        )}

        {report?.byClient?.length > 0 && (
          <div>
            <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              By Client
            </h3>
            <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {report.byClient.map((row) => (
                <div
                  key={row.client.id}
                  className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span style={{ color: 'var(--ink)' }}>{row.client.name}</span>
                  <span className="num" style={{ color: 'var(--ink-muted)' }}>
                    {row.paymentCount} payments · {formatCurrency(row.totalReceived)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
