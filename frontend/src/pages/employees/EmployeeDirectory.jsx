import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'
import { unwrapError } from '../../api/unwrap'
import CreateEmployeeModal from './CreateEmployeeModal'

const PAGE_SIZE = 24

export default function EmployeeDirectory() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [departments, setDepartments] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    employeesApi
      .listUsers({ departmentId: departmentId || undefined, page, pageSize: PAGE_SIZE })
      .then(({ rows: fetched, meta: fetchedMeta }) => {
        setRows(fetched)
        setMeta(fetchedMeta)
      })
      .catch((err) => setError(unwrapError(err, 'Could not load the directory.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    departmentsApi.listDepartments().then(setDepartments).catch(() => setDepartments([]))
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, page])

  const canCreate =
    user?.roleName !== 'Manager' &&
    (user?.roleType === 'SUPER_ADMIN' || can('CREATE_EMPLOYEE'))

  // Mirrors the backend rule (FRS Section 9): never your own account; a Super
  // Admin may change anyone; an Admin needs MANAGE_USERS and may only change
  // plain User accounts.
  function canChangeStatus(row) {
    if (row.id === user?.id) return false
    if (user?.roleType === 'SUPER_ADMIN') return true
    return user?.roleType === 'ADMIN' && can('MANAGE_USERS') && row.roleType === 'USER'
  }

  async function toggleUserStatus(row) {
    const nextStatus = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (!window.confirm(`${nextStatus === 'ACTIVE' ? 'Activate' : 'Deactivate'} the account for ${row.email}?`)) return
    setError('')
    try {
      await employeesApi.setUserStatus(row.id, nextStatus)
      load()
    } catch (err) {
      setError(unwrapError(err, "Could not change this user's account status."))
    }
  }

  return (
    <AppShell
      navItems={navItems}
      title="Employee Directory"
      subtitle="Everyone in the organization, with roles, departments and status."
      topbarActions={
        canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            New Employee
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={departmentId}
            onChange={(e) => {
              setPage(1)
              setDepartmentId(e.target.value)
            }}
            className="rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {meta && (
            <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              {meta.totalCount} {meta.totalCount === 1 ? 'person' : 'people'}
            </span>
          )}
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
            No one found.
          </p>
        ) : (
          <>
            <div className="dir-grid grid grid-cols-4 gap-4">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="dir-card flex flex-col items-start gap-2 rounded-xl border p-4 transition-shadow hover:shadow-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  <button
                    type="button"
                    onClick={() => row.employee && navigate(`/employees/${row.employee.id}`)}
                    disabled={!row.employee}
                    className="flex w-full flex-col items-start gap-2 text-left disabled:opacity-60"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {(row.employee?.firstName?.[0] || row.email[0]).toUpperCase()}
                    </div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : row.email}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {row.employee?.designation || '—'}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      {row.employee?.department?.name || 'No department'}
                    </div>
                    <StatusBadge status={row.employee?.status} entity="employment" />
                  </button>
                  {canChangeStatus(row) && (
                    <button
                      type="button"
                      onClick={() => toggleUserStatus(row)}
                      className="text-[11px] font-medium"
                      style={{ color: row.status === 'ACTIVE' ? 'var(--danger)' : 'var(--success)' }}
                    >
                      {row.status === 'ACTIVE' ? 'Deactivate Account' : 'Activate Account'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <span className="num">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-md border px-3 py-1 font-medium disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-md border px-3 py-1 font-medium disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateEmployeeModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </AppShell>
  )
}
