import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Plus, Trash2, X } from 'lucide-react'
import * as salariesApi from '../../api/salaries'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, toIsoDateTime } from '../../utils/format'

const emptyComponent = { label: '', type: 'EARNING', amount: '' }

export default function SalaryStructureFormModal({ employeeId, onClose, onSaved }) {
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      effectiveFrom: new Date().toISOString().slice(0, 10),
      components: [
        { ...emptyComponent, label: 'Basic', type: 'EARNING' },
      ],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'components' })
  const components = watch('components')

  const preview = components.reduce(
    (acc, c) => {
      const amount = Number(c.amount) || 0
      if (c.type === 'DEDUCTION') acc.deductions += amount
      else acc.earnings += amount
      return acc
    },
    { earnings: 0, deductions: 0 }
  )

  async function onSubmit(data) {
    setFormError('')
    if (!data.components.length) {
      setFormError('Add at least one component.')
      return
    }
    if (!data.components.some((c) => c.type === 'EARNING')) {
      setFormError('At least one EARNING component is required.')
      return
    }
    setIsSaving(true)
    try {
      await salariesApi.setSalaryStructure(employeeId, {
        effectiveFrom: toIsoDateTime(data.effectiveFrom),
        components: data.components.map((c) => ({
          label: c.label,
          type: c.type,
          amount: Number(c.amount),
        })),
      })
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this salary structure.'))
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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            New Salary Structure Revision
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

        <p className="mb-3 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          This creates a new effective-dated version — there is no in-place edit. A clashing effective date for this
          employee will be rejected.
        </p>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
            Effective From
          </label>
          <input
            type="date"
            {...register('effectiveFrom', { required: 'Effective date is required.' })}
            className="num w-full rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          {errors.effectiveFrom && (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--danger)' }}>
              {errors.effectiveFrom.message}
            </p>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              Components
            </h3>
            <button
              type="button"
              onClick={() => append({ ...emptyComponent })}
              className="flex items-center gap-1 text-[12px] font-medium"
              style={{ color: 'var(--accent)' }}
            >
              <Plus size={14} /> Add component
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <div key={field.id} className="grid items-start gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
                <input
                  {...register(`components.${index}.label`, { required: 'Required' })}
                  placeholder="Label (e.g. Basic, HRA, PF)"
                  className="rounded-lg border px-2.5 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
                <select
                  {...register(`components.${index}.type`)}
                  className="rounded-lg border px-2.5 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="EARNING">Earning</option>
                  <option value="DEDUCTION">Deduction</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  {...register(`components.${index}.amount`, { required: true, min: 0 })}
                  placeholder="Amount"
                  className="num rounded-lg border px-2.5 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
                <button
                  type="button"
                  onClick={() => fields.length > 1 && remove(index)}
                  disabled={fields.length === 1}
                  className="flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-30"
                  style={{ color: 'var(--danger)' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-col items-end gap-1 text-[13px]">
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Gross Earnings: </span>
              <span className="num font-medium" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.earnings)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Total Deductions: </span>
              <span className="num font-medium" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.deductions)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Net Salary: </span>
              <span className="num text-[16px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.earnings - preview.deductions)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-[13px] font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {isSaving ? 'Saving…' : 'Save Revision'}
          </button>
        </div>
      </form>
    </div>
  )
}
