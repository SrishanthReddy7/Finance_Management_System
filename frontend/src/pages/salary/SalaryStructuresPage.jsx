import { useEffect, useState } from 'react'
import AppShell from '../../components/layout/AppShell'
import SalaryStructurePanel from '../../components/salary/SalaryStructurePanel'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'

// There's no bulk "list all salary structures" endpoint, so this page starts
// from the Directory/Users list and fetches the selected employee's
// structure on demand, per spec.
export default function SalaryStructuresPage() {
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [departments, setDepartments] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    departmentsApi.listDepartments().then(setDepartments).catch(() => setDepartments([]))
  }, [])

  useEffect(() => {
    employeesApi
      .listUsers({ departmentId: departmentId || undefined, pageSize: 100 })
      .then(({ rows: fetched }) => setRows(fetched.filter((r) => r.employee)))
      .catch(() => setRows([]))
  }, [departmentId])

  const filtered = rows.filter((r) => {
    if (!search) return true
    const name = `${r.employee.firstName} ${r.employee.lastName}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

  return (
    <AppShell navItems={navItems} title="Salary Structures" subtitle="Select an employee to view or update their salary structure.">
      <div className="grid gap-6" style={{ gridTemplateColumns: '280px 1fr' }}>
        <div className="flex flex-col gap-3">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
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
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {filtered.map((r) => (
              <button
                key={r.employee.id}
                type="button"
                onClick={() => setSelected(r.employee)}
                className="block w-full border-b px-3 py-2.5 text-left text-[13px] last:border-b-0"
                style={{
                  borderColor: 'var(--border)',
                  background: selected?.id === r.employee.id ? 'var(--accent-soft)' : 'transparent',
                  color: selected?.id === r.employee.id ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                <div className="font-medium">
                  {r.employee.firstName} {r.employee.lastName}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {r.employee.designation}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="p-3 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                No matches.
              </p>
            )}
          </div>
        </div>

        <div>
          {selected ? (
            <>
              <h3 className="mb-3 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                {selected.firstName} {selected.lastName}
              </h3>
              <SalaryStructurePanel employeeId={selected.id} />
            </>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              Select an employee to view their salary structure.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  )
}
