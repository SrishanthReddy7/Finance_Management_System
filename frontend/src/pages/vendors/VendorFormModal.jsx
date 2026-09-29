import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'
import * as vendorsApi from '../../api/vendors'
import { unwrapError } from '../../api/unwrap'

const STATUSES = ['ACTIVE', 'INACTIVE']

export default function VendorFormModal({ vendor, onClose, onSaved }) {
  const isEditMode = !!vendor
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: vendor?.name || '',
      category: vendor?.category || '',
      contactEmail: vendor?.contactEmail || '',
      contactPhone: vendor?.contactPhone || '',
      billingAddress: vendor?.billingAddress || '',
      gstin: vendor?.gstin || '',
      servicesOffered: vendor?.servicesOffered || '',
      paymentTerms: vendor?.paymentTerms || '',
      currency: vendor?.currency || 'INR',
      bankDetails: vendor?.bankDetailsRedacted ? '' : vendor?.bankDetails || '',
      status: vendor?.status || 'ACTIVE',
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
      const body = {
        name: data.name,
        category: data.category,
        contactEmail: data.contactEmail || undefined,
        contactPhone: data.contactPhone || undefined,
        billingAddress: data.billingAddress || undefined,
        gstin: data.gstin || undefined,
        servicesOffered: data.servicesOffered || undefined,
        paymentTerms: data.paymentTerms || undefined,
        currency: data.currency || undefined,
        bankDetails: data.bankDetails || undefined,
        status: data.status,
      }
      if (isEditMode) {
        await vendorsApi.updateVendor(vendor.id, body)
      } else {
        await vendorsApi.createVendor(body)
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this vendor.'))
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
            {isEditMode ? 'Edit Vendor' : 'New Vendor'}
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
            <Field label="Name" error={errors.name}>
              <input
                {...register('name', { required: 'Name is required.' })}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
            <Field label="Category" error={errors.category}>
              <input
                {...register('category', { required: 'Category is required.' })}
                placeholder="e.g. Software, Office Supplies"
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          </div>

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

          <Field label="Services Offered">
            <textarea
              rows={2}
              {...register('servicesOffered')}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field
            label="Bank Details"
            hint={isEditMode && vendor?.bankDetailsRedacted ? 'Hidden — your role cannot view it. Leave blank to keep it unchanged.' : undefined}
          >
            <textarea
              rows={2}
              placeholder={isEditMode && vendor?.bankDetailsRedacted ? 'Hidden' : ''}
              {...register('bankDetails')}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

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
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Vendor'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, error, hint, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {children}
      {hint && (
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
