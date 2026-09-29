import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as employeesApi from '../../api/employees'
import * as departmentsApi from '../../api/departments'
import { unwrapError } from '../../api/unwrap'

// Only creates a plain Employee account (roleType USER, no roleId) --
// creating an ADMIN-tier account requires CREATE_ADMIN, which no seeded
// role holds except Super Admin via the bypass, and there is no GET /roles
// endpoint anywhere to safely discover a role's id from the frontend for a
// role picker. Scoped to the one case that's both real and safely buildable.
export default function CreateEmployeeModal({ onClose, onSaved }) {
  const [departments, setDepartments] = useState([])
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const { register, handleSubmit } = useForm({
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      temporaryPassword: '',
      employeeCode: '',
      designation: '',
      departmentId: '',
    },
  })

  useEffect(() => {
    departmentsApi.listDepartments().then(setDepartments).catch(() => setDepartments([]))
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      await employeesApi.createEmployee({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        temporaryPassword: data.temporaryPassword,
        employeeCode: data.employeeCode,
        designation: data.designation,
        departmentId: data.departmentId || undefined,
        roleType: 'USER',
      })
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not create this employee.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={onClose}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            New Employee
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

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name">
              <input {...register('firstName', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="Last Name">
              <input {...register('lastName', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>
          <Field label="Email">
            <input type="email" {...register('email', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>
          <Field label="Temporary Password (min 8 characters)">
            <input type="text" {...register('temporaryPassword', { required: true, minLength: 8 })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee Code">
              <input {...register('employeeCode', { required: true })} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="Designation">
              <input {...register('designation', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>
          <Field label="Department (optional)">
            <select {...register('departmentId')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Creating…' : 'Create Employee'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
