import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import AppShell from '../../components/layout/AppShell'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { toIsoDateTime } from '../../utils/format'

const PAYMENT_METHODS = ['Cash', 'Card', 'UPI', 'Bank Transfer']

export default function SubmitExpense() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const { id: claimId } = useParams()
  const isEditMode = !!claimId
  const navItems = buildNavItems(user, can)

  const [categories, setCategories] = useState([])
  const [isLoading, setIsLoading] = useState(isEditMode)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      categoryId: '',
      amount: '',
      expenseDate: '',
      purpose: '',
      paymentMethod: '',
      receiptMissing: false,
      receiptMissingReason: '',
    },
  })

  const receiptMissing = watch('receiptMissing')

  useEffect(() => {
    expensesApi.listCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!isEditMode) return
    expensesApi
      .getClaim(claimId)
      .then((claim) => {
        reset({
          categoryId: claim.categoryId,
          amount: claim.amount,
          expenseDate: claim.expenseDate.slice(0, 10),
          purpose: claim.purpose,
          paymentMethod: claim.paymentMethod,
          receiptMissing: claim.receiptMissing,
          receiptMissingReason: claim.receiptMissingReason || '',
        })
      })
      .catch((err) => setFormError(unwrapError(err, 'Could not load this claim.')))
      .finally(() => setIsLoading(false))
  }, [isEditMode, claimId, reset])

  function buildBody(data) {
    return {
      categoryId: data.categoryId,
      amount: Number(data.amount),
      expenseDate: toIsoDateTime(data.expenseDate),
      purpose: data.purpose,
      paymentMethod: data.paymentMethod,
      receiptMissing: !!data.receiptMissing,
      receiptMissingReason: data.receiptMissing ? data.receiptMissingReason : undefined,
    }
  }

  async function saveAsDraft(data) {
    setFormError('')
    setIsSaving(true)
    try {
      if (isEditMode) {
        await expensesApi.updateClaim(claimId, buildBody(data))
      } else {
        await expensesApi.createClaim(buildBody(data))
      }
      navigate('/expenses')
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this claim.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function submitForApproval(data) {
    setFormError('')

    const file = data.receipt?.[0]
    if (!data.receiptMissing && !file && !isEditMode) {
      setFormError('Attach a receipt, or check "No receipt available" and give a reason.')
      return
    }

    setIsSaving(true)
    try {
      let id = claimId
      if (isEditMode) {
        await expensesApi.updateClaim(claimId, buildBody(data))
      } else {
        const claim = await expensesApi.createClaim(buildBody(data))
        id = claim.id
      }

      if (file) {
        await expensesApi.addReceipt(id, file)
      }

      await expensesApi.submitClaim(id)
      navigate('/expenses')
    } catch (err) {
      setFormError(unwrapError(err, 'Could not submit this claim.'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <AppShell navItems={navItems} title={isEditMode ? 'Resubmit Expense' : 'Submit New Expense'}>
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Loading…
        </p>
      </AppShell>
    )
  }

  return (
    <AppShell navItems={navItems} title={isEditMode ? 'Resubmit Expense' : 'Submit New Expense'} subtitle={['Manager', 'Team Lead', 'Finance Admin', 'Employee'].includes(user?.roleName) ? 'Attach your receipt and submit the claim for approval.' : undefined}>
      <form className="max-w-xl rounded-xl border p-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        {formError && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Field label="Category" error={errors.categoryId}>
            <select
              {...register('categoryId', { required: 'Category is required.' })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <option value="">Select a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount (₹)" error={errors.amount}>
            <input
              type="number"
              step="0.01"
              {...register('amount', { required: 'Amount is required.', min: { value: 0.01, message: 'Amount must be positive.' } })}
              className="num w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Expense Date" error={errors.expenseDate}>
            <input
              type="date"
              {...register('expenseDate', { required: 'Expense date is required.' })}
              className="num w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <Field label="Payment Method" error={errors.paymentMethod}>
            <select
              {...register('paymentMethod', { required: 'Payment method is required.' })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <option value="">Select a payment method…</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Purpose" error={errors.purpose}>
            <textarea
              rows={3}
              {...register('purpose', { required: 'Purpose is required.', minLength: { value: 3, message: 'Purpose is too short.' } })}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            />
          </Field>

          <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" {...register('receiptMissing')} />
            No receipt available
          </label>

          {receiptMissing ? (
            <Field label="Reason (required)" error={errors.receiptMissingReason}>
              <textarea
                rows={2}
                {...register('receiptMissingReason', {
                  required: receiptMissing ? 'A reason is required when there is no receipt.' : false,
                })}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              />
            </Field>
          ) : (
            <Field label="Receipt">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                {...register('receipt')}
                className="w-full text-[13px]"
                style={{ color: 'var(--ink)' }}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                JPG, PNG, WEBP, or PDF, up to 5MB.
              </p>
            </Field>
          )}

          <div className="mt-2 flex gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSubmit(saveAsDraft)}
              className="rounded-lg border px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Save as Draft
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSubmit(submitForApproval)}
              className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              Submit for Approval
            </button>
          </div>
        </div>
      </form>
    </AppShell>
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
