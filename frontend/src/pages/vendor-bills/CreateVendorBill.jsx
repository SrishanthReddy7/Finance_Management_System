import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as vendorsApi from '../../api/vendors'
import * as projectsApi from '../../api/projects'
import * as vendorBillsApi from '../../api/vendorBills'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, toIsoDateTime } from '../../utils/format'

const emptyLineItem = { description: '', amount: '', taxRate: '' }

export default function CreateVendorBill() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const navItems = buildNavItems(user, can)

  const [vendors, setVendors] = useState([])
  const [projects, setProjects] = useState([])
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
      vendorId: '',
      projectId: '',
      billNumber: '',
      billDate: '',
      dueDate: '',
      poReference: '',
      paymentTerms: '',
      currency: 'INR',
      notes: '',
      lineItems: [{ ...emptyLineItem }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lineItems' })
  const lineItems = watch('lineItems')

  useEffect(() => {
    vendorsApi.listVendors({ status: 'ACTIVE', pageSize: 100 }).then(({ rows }) => setVendors(rows)).catch(() => setVendors([]))
    projectsApi.listProjects({ pageSize: 100 }).then(({ rows }) => setProjects(rows)).catch(() => setProjects([]))
  }, [])

  const preview = lineItems.reduce(
    (acc, item) => {
      const amount = Number(item.amount) || 0
      const taxRate = Number(item.taxRate) || 0
      acc.subtotal += amount
      acc.tax += (amount * taxRate) / 100
      return acc
    },
    { subtotal: 0, tax: 0 }
  )

  async function onSubmit(data) {
    setFormError('')
    if (!data.lineItems.length) {
      setFormError('Add at least one line item.')
      return
    }

    setIsSaving(true)
    try {
      const body = {
        vendorId: data.vendorId,
        projectId: data.projectId || undefined,
        billNumber: data.billNumber,
        billDate: toIsoDateTime(data.billDate),
        dueDate: toIsoDateTime(data.dueDate),
        poReference: data.poReference || undefined,
        paymentTerms: data.paymentTerms || undefined,
        currency: data.currency || undefined,
        notes: data.notes || undefined,
        lineItems: data.lineItems.map((item) => ({
          description: item.description,
          amount: Number(item.amount),
          taxRate: item.taxRate ? Number(item.taxRate) : undefined,
        })),
      }
      const bill = await vendorBillsApi.createVendorBill(body)
      navigate(`/vendor-bills/${bill.id}`)
    } catch (err) {
      setFormError(unwrapError(err, 'Could not create this vendor bill.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AppShell navItems={navItems} title="New Vendor Bill" subtitle="Record a new vendor bill for verification.">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="max-w-3xl rounded-xl border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {formError && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {formError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Vendor" error={errors.vendorId}>
            <select
              {...register('vendorId', { required: 'Vendor is required.' })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <option value="">Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Project (optional)">
            <select
              {...register('projectId')}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Bill Number" error={errors.billNumber}>
            <input
              {...register('billNumber', { required: 'Bill number is required.' })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="PO Reference (optional)">
            <input
              {...register('poReference')}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Bill Date" error={errors.billDate}>
            <input
              type="date"
              {...register('billDate', { required: 'Bill date is required.' })}
              className="num w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Due Date" error={errors.dueDate}>
            <input
              type="date"
              {...register('dueDate', { required: 'Due date is required.' })}
              className="num w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Payment Terms (optional)">
            <input
              {...register('paymentTerms')}
              placeholder="Defaults from vendor"
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Currency">
            <input
              {...register('currency')}
              className="num w-full rounded-lg border px-3 py-2 text-[13px] uppercase"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <textarea
            rows={2}
            {...register('notes')}
            className="w-full rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
        </Field>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              Line Items
            </h3>
            <button
              type="button"
              onClick={() => append({ ...emptyLineItem })}
              className="flex items-center gap-1 text-[12px] font-medium"
              style={{ color: 'var(--accent)' }}
            >
              <Plus size={14} /> Add line
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <div key={field.id} className="grid items-start gap-2" style={{ gridTemplateColumns: '3fr 1fr 1fr auto' }}>
                <input
                  {...register(`lineItems.${index}.description`, { required: 'Required' })}
                  placeholder="Description"
                  className="rounded-lg border px-2.5 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
                <input
                  type="number"
                  step="0.01"
                  {...register(`lineItems.${index}.amount`, { required: true, min: 0.01 })}
                  placeholder="Amount"
                  className="num rounded-lg border px-2.5 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
                <input
                  type="number"
                  step="0.01"
                  {...register(`lineItems.${index}.taxRate`)}
                  placeholder="Tax %"
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

          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            Totals are calculated by the server on save — the figures below are a live preview only.
          </p>

          <div className="mt-3 flex flex-col items-end gap-1 text-[13px]">
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Subtotal: </span>
              <span className="num font-medium" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.subtotal)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Tax: </span>
              <span className="num font-medium" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.tax)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--ink-muted)' }}>Total: </span>
              <span className="num text-[16px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(preview.subtotal + preview.tax)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {isSaving ? 'Creating…' : 'Create Vendor Bill'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}

function Field({ label, error, children }) {
  return (
    <div className="mt-4 first:mt-0">
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
