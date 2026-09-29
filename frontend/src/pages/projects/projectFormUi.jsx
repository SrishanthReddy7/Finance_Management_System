import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import * as employeesApi from '../../api/employees'

// Shared building blocks for the project / member / milestone modals.

export const inputClass = 'w-full rounded-lg border px-3 py-2 text-[13px]'
export const inputStyle = { borderColor: 'var(--border)', color: 'var(--ink)' }

export function ModalShell({ title, onClose, onSubmit, children, submitLabel, isSaving, formError }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--ink-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-4">{children}</div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
            {isSaving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

export function Field({ label, error, hint, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--danger)' }}>
          {error.message}
        </p>
      )}
    </div>
  )
}

// People pickers. There is no dedicated employee-list endpoint, so this reads
// the same GET /users the Employee Directory uses (any ADMIN-tier role can call
// it, which includes everyone holding MANAGE_PROJECTS) and keeps ACTIVE users
// that have an employee profile.
export function useEmployeeOptions() {
  const [options, setOptions] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .listUsers({ pageSize: 100 })
      .then(({ rows }) => {
        if (cancelled) return
        setOptions(
          rows
            .filter((u) => u.employee && u.status === 'ACTIVE')
            .map((u) => ({
              id: u.employee.id,
              label: `${u.employee.firstName} ${u.employee.lastName}${u.employee.designation ? ` — ${u.employee.designation}` : ''}`,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
        )
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { options, isLoading }
}

// ISO timestamp from the API -> value for <input type="date">.
export function toDateInput(value) {
  return value ? String(value).slice(0, 10) : ''
}
