import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as departmentsApi from '../../api/departments'
import * as employeesApi from '../../api/employees'
import { unwrapError } from '../../api/unwrap'
import DepartmentFormModal from './DepartmentFormModal'

export default function OrgTeams() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [departments, setDepartments] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingDept, setEditingDept] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  function load() {
    setIsLoading(true)
    setError('')
    departmentsApi
      .listDepartments({ includeInactive: true })
      .then(setDepartments)
      .catch((err) => setError(unwrapError(err, 'Could not load departments.')))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleStatus(dept) {
    try {
      await departmentsApi.setDepartmentStatus(dept.id, !dept.isActive)
      load()
    } catch (err) {
      setError(unwrapError(err, 'Could not change this department\'s status.'))
    }
  }

  function handleSaved() {
    setEditingDept(null)
    setShowCreate(false)
    load()
  }

  return (
    <AppShell navItems={navItems} title="Org & Teams" subtitle="Departments and the teams inside them.">
      <div className="flex flex-col gap-8">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              Departments
            </h3>
            {can('MANAGE_USERS') && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                New Department
              </button>
            )}
          </div>

          {error && (
            <div className="mb-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {isLoading ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Loading…
            </p>
          ) : departments.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              No departments yet.
            </p>
          ) : (
            <div className="org-list rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {departments.map((d) => (
                <div key={d.id} className="org-row flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div style={{ color: 'var(--ink)' }}>
                      {d.name} {d.code ? <span className="num" style={{ color: 'var(--ink-faint)' }}>({d.code})</span> : null}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {d._count?.employees ?? 0} employees
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                      style={{
                        background: d.isActive ? 'var(--success-soft)' : 'var(--bg)',
                        color: d.isActive ? 'var(--success)' : 'var(--ink-muted)',
                      }}
                    >
                      {d.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {can('MANAGE_USERS') && (
                      <>
                        <button type="button" onClick={() => setEditingDept(d)} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                          Edit
                        </button>
                        <button type="button" onClick={() => toggleStatus(d)} className="text-[12px] font-medium" style={{ color: d.isActive ? 'var(--danger)' : 'var(--success)' }}>
                          {d.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <MyTeamSection selfId={user?.employee?.id} isSuperAdmin={user?.roleType === 'SUPER_ADMIN'} showAvatars={user?.roleType === 'ADMIN' && ['Manager', 'Team Lead', 'Finance Admin'].includes(user?.roleName)} />
      </div>

      {(editingDept || showCreate) && (
        <DepartmentFormModal
          department={editingDept}
          onClose={() => {
            setEditingDept(null)
            setShowCreate(false)
          }}
          onSaved={handleSaved}
        />
      )}
    </AppShell>
  )
}

function MyTeamSection({ selfId, isSuperAdmin, showAvatars }) {
  const [directory, setDirectory] = useState([])
  const [targetId, setTargetId] = useState(selfId || '')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isSuperAdmin) {
      employeesApi.listUsers({ pageSize: 100 }).then(({ rows: fetched }) => setDirectory(fetched.filter((r) => r.employee))).catch(() => setDirectory([]))
    }
  }, [isSuperAdmin])

  useEffect(() => {
    if (!targetId) return
    setRows(null)
    setError('')
    employeesApi
      .getSubordinates(targetId)
      .then(setRows)
      .catch((err) => setError(unwrapError(err, "You don't have access to view this person's team.")))
  }, [targetId])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
          {targetId === selfId ? 'My Team' : 'Team'}
        </h3>
        {isSuperAdmin && (
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-[12px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <option value={selfId}>My Team</option>
            {directory
              .filter((r) => r.employee.id !== selfId)
              .map((r) => (
                <option key={r.employee.id} value={r.employee.id}>
                  View team of {r.employee.firstName} {r.employee.lastName}
                </option>
              ))}
          </select>
        )}
      </div>

      {error ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          {error}
        </p>
      ) : rows === null ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No one reports here.
        </p>
      ) : (
        <div className="org-list rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {rows.map((row) => (
            <Link
              key={row.id}
              to={`/employees/${row.id}`}
              className="org-row flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-3">
                {showAvatars && (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {(row.firstName?.[0] || '?').toUpperCase()}
                  </span>
                )}
                <div>
                  <div style={{ color: 'var(--ink)' }}>
                    {row.firstName} {row.lastName}
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {row.designation} · {row.department?.name || 'No department'}
                  </div>
                </div>
              </div>
              <StatusBadge status={row.status} entity="employment" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
