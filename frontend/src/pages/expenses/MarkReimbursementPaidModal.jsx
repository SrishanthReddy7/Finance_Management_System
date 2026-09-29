import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'

// FRS Section 38 Q14: only bank transfer and petty cash are supported.
const METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'PETTY_CASH', label: 'Petty Cash' },
]

export default function MarkReimbursementPaidModal({ claim, onClose, onSaved }) {
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const { register, handleSubmit } = useForm({ defaultValues: { method: 'BANK_TRANSFER', referenceNo: '' } })

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      await expensesApi.processReimbursement(claim.id, {
        method: data.method,
        referenceNo: data.referenceNo.trim() || undefined,
      })
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not record this reimbursement.'))
    } finally {
      setIsSaving(false)
    }
  }

  const employeeName = claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName}` : 'the employee'

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
            Mark Reimbursement Paid
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--ink-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Record that <span style={{ color: 'var(--ink)' }}>{employeeName}</span> was paid{' '}
          <span className="num font-medium" style={{ color: 'var(--ink)' }}>
            {formatCurrency(claim.amount)}
          </span>{' '}
          for this claim. The system only records the payment; it does not move money.
        </p>

        {formError && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Field label="Method">
            <select {...register('method', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference No. (optional)">
            <input
              {...register('referenceNo', { maxLength: 100 })}
              placeholder="Bank transaction ID / petty cash voucher"
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: 'var(--accent)' }}>
              {isSaving ? 'Saving…' : 'Mark Paid'}
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
