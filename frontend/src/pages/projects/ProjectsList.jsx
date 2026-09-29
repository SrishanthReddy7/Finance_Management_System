import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import PageTabs from '../../components/layout/PageTabs'
import DataTable from '../../components/ui/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as projectsApi from '../../api/projects'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
import ProjectFormModal from './ProjectFormModal'

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Planned', value: 'PLANNED' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'On Hold', value: 'ON_HOLD' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

const PAGE_SIZE = 20

export default function ProjectsList() {
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
  const [editingProject, setEditingProject] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    projectsApi
      .listProjects({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        if (cancelled) return
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load projects.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statusFilter, page, reloadKey])

  const columns = [
    { key: 'name', label: 'Project' },
    { key: 'client', label: 'Client', render: (row) => row.client?.name || '—' },
    {
      key: 'projectManager',
      label: 'PM',
      render: (row) => (row.projectManager ? `${row.projectManager.firstName} ${row.projectManager.lastName}` : '—'),
    },
    { key: 'billingModel', label: 'Billing Model', render: (row) => row.billingModel.replace(/_/g, ' ') },
    {
      key: 'contractValue',
      label: 'Contract Value',
      align: 'right',
      render: (row) => <span className="num">{row.contractValue != null ? formatCurrency(row.contractValue) : '—'}</span>,
    },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} entity="project" /> },
    ...(can('MANAGE_PROJECTS')
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingProject(row)
                }}
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

  function handleSaved() {
    setShowCreate(false)
    setEditingProject(null)
    setReloadKey((k) => k + 1)
  }

  return (
    <AppShell
      navItems={navItems}
      title="Clients & Projects"
      subtitle="Projects across clients, with billing model and status."
      topbarActions={
        can('MANAGE_PROJECTS') && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            New Project
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <PageTabs tabs={[{ label: 'Clients', href: '/clients' }, { label: 'Projects', href: '/projects' }]} />

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
            No projects found.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(row) => navigate(`/projects/${row.id}`)}
            page={meta?.page}
            pageSize={meta?.pageSize}
            totalCount={meta?.totalCount}
            onPageChange={setPage}
          />
        )}
      </div>
      {(showCreate || editingProject) && (
        <ProjectFormModal
          project={editingProject}
          onClose={() => {
            setShowCreate(false)
            setEditingProject(null)
          }}
          onSaved={handleSaved}
        />
      )}
    </AppShell>
  )
}
