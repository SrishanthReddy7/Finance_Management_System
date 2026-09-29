import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as clientsApi from '../../api/clients'
import { unwrapError } from '../../api/unwrap'

const STATUSES = ['ACTIVE', 'INACTIVE', 'PROSPECT']

export default function ClientFormModal({ client, onClose, onSaved }) {
  const isEditMode = !!client
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: client?.name || '',
      contactEmail: client?.contactEmail || '',
      contactPhone: client?.contactPhone || '',
      billingAddress: client?.billingAddress || '',
      gstin: client?.gstin || '',
      paymentTerms: client?.paymentTerms || '',
      currency: client?.currency || 'INR',
      status: client?.status || 'ACTIVE',
    },
  })

  // Esc closes, matching the pattern users expect from a modal.
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
      const body = {
        name: data.name,
        contactEmail: data.contactEmail || undefined,
        contactPhone: data.contactPhone || undefined,
        billingAddress: data.billingAddress || undefined,
        gstin: data.gstin || undefined,
        paymentTerms: data.paymentTerms || undefined,
        currency: data.currency || undefined,
        status: data.status,
      }
      if (isEditMode) {
        await clientsApi.updateClient(client.id, body)
      } else {
        await clientsApi.createClient(body)
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this client.'))
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
            {isEditMode ? 'Edit Client' : 'New Client'}
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
          <Field label="Name" error={errors.name}>
            <input
              {...register('name', { required: 'Name is required.' })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact Email">
              <input
                type="email"
                {...register('contactEmail')}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
            <Field label="Contact Phone">
              <input
                {...register('contactPhone')}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          </div>

          <Field label="Billing Address">
            <textarea
              rows={2}
              {...register('billingAddress')}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="GSTIN">
              <input
                {...register('gstin')}
                className="num w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
            <Field label="Payment Terms">
              <input
                {...register('paymentTerms')}
                placeholder="e.g. Net 30"
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Currency">
              <input
                {...register('currency')}
                className="num w-full rounded-lg border px-3 py-2 text-[13px] uppercase"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
            <Field label="Status">
              <select
                {...register('status')}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-2 flex justify-end gap-3">
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
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Client'}
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
