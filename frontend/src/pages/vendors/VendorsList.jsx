import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as vendorsApi from '../../api/vendors'
import { unwrapError } from '../../api/unwrap'
import VendorFormModal from './VendorFormModal'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'INACTIVE' },
]

const PAGE_SIZE = 20

export default function VendorsList() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingVendor, setEditingVendor] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const { rows: fetched, meta: fetchedMeta } = await vendorsApi.listVendors({
        status: statusFilter || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setRows(fetched)
      setMeta(fetchedMeta)
    } catch (err) {
      setError(unwrapError(err, 'Could not load vendors.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search, page])

  function handleSaved() {
    setEditingVendor(null)
    setShowCreate(false)
    load()
  }

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: (row) => row.category.replace(/_/g, ' ') },
    { key: 'contactEmail', label: 'Contact', render: (row) => row.contactEmail || '—' },
    { key: 'gstin', label: 'GSTIN', render: (row) => <span className="num">{row.gstin || '—'}</span> },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="vendor" /> },
    ...(can('MANAGE_VENDORS')
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) => (
              <button
                type="button"
                onClick={() => setEditingVendor(row)}
                className="text-[12px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                Edit
              </button>
            ),
          },
        ]
      : []),
  ]

  return (
    <AppShell
      navItems={navItems}
      title="Vendors & Bills"

      subtitle="Manage vendors and their bank and GST details."
      topbarActions={
        can('MANAGE_VENDORS') && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Vendor
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <PageTabs tabs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Bills', href: '/vendor-bills' }]} />

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setPage(1)
              setSearch(e.target.value)
            }}
            placeholder="Search by name, email, GSTIN…"
            className="w-64 rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
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
            No vendors found.
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

      {(editingVendor || showCreate) && (
        <VendorFormModal
          vendor={editingVendor}
          onClose={() => {
            setEditingVendor(null)
            setShowCreate(false)
          }}
          onSaved={handleSaved}
        />
      )}
    </AppShell>
  )
}
