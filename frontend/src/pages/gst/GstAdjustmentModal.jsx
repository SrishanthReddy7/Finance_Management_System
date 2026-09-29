import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as gstApi from '../../api/gst'
import { unwrapError } from '../../api/unwrap'
import { toIsoDateTime } from '../../utils/format'

export default function GstAdjustmentModal({ onClose, onSaved }) {
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      direction: 'OUTPUT',
      documentDate: new Date().toISOString().slice(0, 10),
      gstRate: 18,
      taxableAmount: '',
      cgstAmount: '',
      sgstAmount: '',
      igstAmount: '',
      note: '',
    },
  })

  async function onSubmit(data) {
    setFormError('')
    const cgst = Number(data.cgstAmount) || 0
    const sgst = Number(data.sgstAmount) || 0
    const igst = Number(data.igstAmount) || 0
    if (cgst === 0 && sgst === 0 && igst === 0) {
      setFormError('At least one of CGST/SGST/IGST must be non-zero.')
      return
    }
    if (igst !== 0 && (cgst !== 0 || sgst !== 0)) {
      setFormError('IGST cannot be combined with CGST/SGST.')
      return
    }
    setIsSaving(true)
    try {
      await gstApi.createAdjustment({
        direction: data.direction,
        documentDate: toIsoDateTime(data.documentDate),
        gstRate: Number(data.gstRate),
        taxableAmount: Number(data.taxableAmount),
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        note: data.note,
      })
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not create this adjustment.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(18,19,26,0.45)' }} onClick={onClose}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
            New GST Adjustment
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
          A wrong figure is corrected with a signed adjustment, never edited in place — this creates a new manual
          transaction, positive or negative.
        </p>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Direction">
              <select {...register('direction')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                <option value="OUTPUT">Output</option>
                <option value="INPUT">Input</option>
              </select>
            </Field>
            <Field label="Document Date">
              <input type="date" {...register('documentDate', { required: true })} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="GST Rate (%)">
              <input type="number" step="0.01" {...register('gstRate', { required: true })} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="Taxable Amount" error={errors.taxableAmount}>
              <input
                type="number"
                step="0.01"
                {...register('taxableAmount', { required: 'Required' })}
                placeholder="Can be negative"
                className="num w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="CGST">
              <input type="number" step="0.01" {...register('cgstAmount')} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="SGST">
              <input type="number" step="0.01" {...register('sgstAmount')} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
            <Field label="IGST">
              <input type="number" step="0.01" {...register('igstAmount')} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
            </Field>
          </div>

          <Field label="Reason (required, min 5 characters)" error={errors.note}>
            <textarea rows={2} {...register('note', { required: 'A reason is required.', minLength: 5 })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Saving…' : 'Create Adjustment'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, error, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--danger)' }}>
          {error.message}
        </p>
      )}
    </div>
  )
}
