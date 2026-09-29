import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Plus, Trash2, X } from 'lucide-react'
import * as budgetsApi from '../../api/budgets'
import * as departmentsApi from '../../api/departments'
import * as projectsApi from '../../api/projects'
import { unwrapError } from '../../api/unwrap'

const SCOPES = ['COMPANY', 'DEPARTMENT', 'PROJECT']

export default function BudgetFormModal({ onClose, onSaved }) {
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
  } = useForm({
    defaultValues: {
      name: '',
      code: '',
      scope: 'COMPANY',
      departmentId: '',
      projectId: '',
      periodLabel: '',
      plannedAmount: '',
      currency: 'INR',
      items: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const scope = watch('scope')

  useEffect(() => {
    departmentsApi.listDepartments().then(setDepartments).catch(() => setDepartments([]))
    projectsApi.listProjects({ pageSize: 100 }).then(({ rows }) => setProjects(rows)).catch(() => setProjects([]))
  }, [])

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const body = {
        name: data.name,
        code: data.code || undefined,
        scope: data.scope,
        departmentId: data.scope === 'DEPARTMENT' ? data.departmentId : undefined,
        projectId: data.scope === 'PROJECT' ? data.projectId : undefined,
        periodLabel: data.periodLabel,
        plannedAmount: Number(data.plannedAmount),
        currency: data.currency || undefined,
        items: data.items.length
          ? data.items.map((it) => ({ category: it.category, amount: Number(it.amount) }))
          : undefined,
      }
      await budgetsApi.createBudget(body)
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not create this budget.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={onClose}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            New Budget
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

          <div className="grid grid-cols-2 gap-4">
            <Field label="Scope">
              <select {...register('scope')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Period Label">
              <input {...register('periodLabel', { required: true })} placeholder="e.g. FY2026-Q3" className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>

          {scope === 'DEPARTMENT' && (
            <Field label="Department">
              <select {...register('departmentId', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {scope === 'PROJECT' && (
            <Field label="Project">
              <select {...register('projectId', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Planned Amount">
              <input type="number" step="0.01" {...register('plannedAmount', { required: true, min: 0.01 })} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="Currency">
              <input {...register('currency')} className="num w-full rounded-lg border px-3 py-2 text-[13px] uppercase" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>

          <Field label="Code (optional)">
            <input {...register('code')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Line Items (optional)
              </h3>
              <button type="button" onClick={() => append({ category: '', amount: '' })} className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                <Plus size={14} /> Add line
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {fields.map((field, index) => (
                <div key={field.id} className="grid items-start gap-2" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
                  <input {...register(`items.${index}.category`, { required: true })} placeholder="Category" className="rounded-lg border px-2.5 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
                  <input type="number" step="0.01" {...register(`items.${index}.amount`, { required: true, min: 0 })} placeholder="Amount" className="num rounded-lg border px-2.5 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
                  <button type="button" onClick={() => remove(index)} className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Creating…' : 'Create Budget'}
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
