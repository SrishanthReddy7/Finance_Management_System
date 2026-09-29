import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as departmentsApi from '../../api/departments'
import { unwrapError } from '../../api/unwrap'

export default function DepartmentFormModal({ department, onClose, onSaved }) {
  const isEditMode = !!department
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const { register, handleSubmit } = useForm({
    defaultValues: {
      name: department?.name || '',
      code: department?.code || '',
      description: department?.description || '',
    },
  })

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
      const body = { name: data.name, code: data.code || undefined, description: data.description || undefined }
      if (isEditMode) {
        await departmentsApi.updateDepartment(department.id, body)
      } else {
        await departmentsApi.createDepartment(body)
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this department.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(18,19,26,0.45)' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            {isEditMode ? 'Edit Department' : 'New Department'}
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
          <Field label="Name">
            <input {...register('name', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>
          <Field label="Code (optional)">
            <input {...register('code')} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>
          <Field label="Description (optional)">
            <textarea rows={2} {...register('description')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Department'}
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
