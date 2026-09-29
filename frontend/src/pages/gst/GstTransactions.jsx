import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import DataTable from '../../components/ui/DataTable'
import TypeChip from '../../components/ui/TypeChip'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as gstApi from '../../api/gst'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import GstAdjustmentModal from './GstAdjustmentModal'

const DIRECTION_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Output', value: 'OUTPUT' },
  { label: 'Input', value: 'INPUT' },
]

const SOURCE_COLORS = {
  INVOICE: 'var(--accent)',
  VENDOR_BILL: 'var(--warning)',
  MANUAL_ADJUSTMENT: 'var(--info)',
}

const PAGE_SIZE = 25

export default function GstTransactions() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [direction, setDirection] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdjustment, setShowAdjustment] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    gstApi
      .listTransactions({ direction: direction || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => setError(unwrapError(err, 'Could not load GST transactions.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, page])

  const columns = [
    { key: 'documentDate', label: 'Date', render: (row) => formatDate(row.documentDate) },
    { key: 'direction', label: 'Direction', render: (row) => <span style={{ color: row.direction === 'OUTPUT' ? 'var(--accent)' : 'var(--warning)' }}>{row.direction}</span> },
    { key: 'source', label: 'Source', render: (row) => <TypeChip label={row.source.replace(/_/g, ' ')} color={SOURCE_COLORS[row.source]} /> },
    { key: 'gstRate', label: 'Rate', align: 'right', render: (row) => <span className="num">{row.gstRate}%</span> },
    { key: 'taxableAmount', label: 'Taxable', align: 'right', render: (row) => <span className="num">{formatCurrency(row.taxableAmount)}</span> },
    { key: 'cgstAmount', label: 'CGST', align: 'right', render: (row) => <span className="num">{formatCurrency(row.cgstAmount)}</span> },
    { key: 'sgstAmount', label: 'SGST', align: 'right', render: (row) => <span className="num">{formatCurrency(row.sgstAmount)}</span> },
    { key: 'igstAmount', label: 'IGST', align: 'right', render: (row) => <span className="num">{formatCurrency(row.igstAmount)}</span> },
  ]

  return (
    <AppShell
      navItems={navItems}
      title="GST & Filings"

      subtitle="Input and output GST transactions."
      topbarActions={
        can('PREPARE_GST_FILING') && (
          <button type="button" onClick={() => setShowAdjustment(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            New Adjustment
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <PageTabs tabs={[{ label: 'Periods', href: '/gst' }, { label: 'Transactions', href: '/gst/transactions' }]} />

        <div className="flex flex-wrap gap-2">
          {DIRECTION_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => {
                setPage(1)
                setDirection(chip.value)
              }}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: direction === chip.value ? 'var(--accent)' : 'var(--border)',
                background: direction === chip.value ? 'var(--accent-soft)' : 'var(--surface)',
                color: direction === chip.value ? 'var(--accent)' : 'var(--ink-muted)',
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
            No GST transactions found.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            page={meta?.page}
            pageSize={meta?.pageSize}
            totalCount={meta?.totalCount}
            onPageChange={setPage}
          />
        )}
      </div>

      {showAdjustment && (
        <GstAdjustmentModal
          onClose={() => setShowAdjustment(false)}
          onSaved={() => {
            setShowAdjustment(false)
            load()
          }}
        />
      )}
    </AppShell>
  )
}
