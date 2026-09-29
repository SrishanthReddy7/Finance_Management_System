import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function CreatePayrollRunModal({ onClose, onSaved }) {
  const now = new Date()
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const { register, handleSubmit } = useForm({
    defaultValues: { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear(), notes: '' },
  })

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const run = await payrollApi.createRun({
        periodMonth: Number(data.periodMonth),
        periodYear: Number(data.periodYear),
        notes: data.notes || undefined,
      })
      onSaved(run)
    } catch (err) {
      setFormError(unwrapError(err, 'Could not create this payroll run.'))
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
            New Payroll Run
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
            <Field label="Month">
              <select {...register('periodMonth', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                {MONTHS.map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year">
              <input
                type="number"
                {...register('periodYear', { required: true })}
                className="num w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea rows={2} {...register('notes')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Creating…' : 'Create Run'}
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
