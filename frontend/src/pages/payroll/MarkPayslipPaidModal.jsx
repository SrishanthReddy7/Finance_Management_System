import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as payrollApi from '../../api/payroll'
import { unwrapError } from '../../api/unwrap'
import { toIsoDateTime } from '../../utils/format'

const METHODS = ['BANK_TRANSFER', 'PETTY_CASH', 'CHEQUE', 'OTHER']

export default function MarkPayslipPaidModal({ runId, payslipId, onClose, onSaved }) {
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const { register, handleSubmit } = useForm({
    defaultValues: { paymentDate: new Date().toISOString().slice(0, 10), method: 'BANK_TRANSFER', referenceNo: '' },
  })

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      await payrollApi.markPayslipPaid(runId, payslipId, {
        paymentDate: toIsoDateTime(data.paymentDate),
        method: data.method,
        referenceNo: data.referenceNo || undefined,
      })
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not mark this payslip paid.'))
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
            Mark Payslip Paid
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
          <Field label="Payment Date">
            <input type="date" {...register('paymentDate', { required: true })} className="num w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
          </Field>
          <Field label="Method">
            <select {...register('method', { required: true })} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference No. (optional)">
            <input {...register('referenceNo')} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }} />
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
