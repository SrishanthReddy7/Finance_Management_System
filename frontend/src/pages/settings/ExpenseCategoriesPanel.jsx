import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import * as expensesApi from '../../api/expenses'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency } from '../../utils/format'
import StatusBadge from '../../components/ui/StatusBadge'
import { Field, ModalShell, inputClass, inputStyle } from '../projects/projectFormUi'

// FRS 11.2: Finance can add / rename / deactivate expense categories without a
// deployment, and 11.3 lets each carry a soft limit (warns the approver) and a
// hard limit (blocks submission). There is no delete: deactivating stops new
// claims while past claims keep their category.
export default function ExpenseCategoriesPanel() {
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // { category? }
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    expensesApi
      .listCategories({ includeInactive: true })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load expense categories.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function toggleActive(category) {
    setBusyId(category.id)
    setError('')
    try {
      await expensesApi.updateCategory(category.id, { isActive: !category.isActive })
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(unwrapError(err, 'Could not update this category.'))
    } finally {
      setBusyId(null)
    }
  }

  function handleSaved() {
    setModal(null)
    setReloadKey((k) => k + 1)
  }

  const limit = (value) => (value != null ? <span className="num">{formatCurrency(value)}</span> : <span style={{ color: 'var(--ink-faint)' }}>—</span>)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="max-w-xl text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          The soft limit warns the approver; the hard limit blocks a claim from being submitted. Deactivating a category
          stops new claims against it — existing claims keep it.
        </p>
        <button
          type="button"
          onClick={() => setModal({})}
          className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          New Category
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No categories yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr style={{ background: '#FAFAFC' }}>
                {['Category', 'Soft Limit', 'Hard Limit', 'Status', ''].map((h, i) => (
                  <th
                    key={h || i}
                    className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)', textAlign: i === 4 ? 'right' : 'left' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, idx) => (
                <tr key={c.id} style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border)', opacity: c.isActive ? 1 : 0.65 }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>
                    {c.name}
                  </td>
                  <td className="px-4 py-2.5">{limit(c.softLimit)}</td>
                  <td className="px-4 py-2.5">{limit(c.hardLimit)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} entity="client" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => setModal({ category: c })} className="mr-4 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => toggleActive(c)}
                      className="text-[12px] font-medium disabled:opacity-60"
                      style={{ color: c.isActive ? 'var(--danger)' : 'var(--accent)' }}
                    >
                      {c.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <CategoryFormModal category={modal.category} onClose={() => setModal(null)} onSaved={handleSaved} />}
    </div>
  )
}

function CategoryFormModal({ category, onClose, onSaved }) {
  const isEditMode = !!category
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: category?.name || '',
      softLimit: category?.softLimit != null ? String(category.softLimit) : '',
      hardLimit: category?.hardLimit != null ? String(category.hardLimit) : '',
    },
  })

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const softLimit = data.softLimit === '' ? null : Number(data.softLimit)
      const hardLimit = data.hardLimit === '' ? null : Number(data.hardLimit)
      if (isEditMode) {
        await expensesApi.updateCategory(category.id, { name: data.name.trim(), softLimit, hardLimit })
      } else {
        await expensesApi.createCategory({
          name: data.name.trim(),
          ...(softLimit != null ? { softLimit } : {}),
          ...(hardLimit != null ? { hardLimit } : {}),
        })
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this category.'))
    } finally {
      setIsSaving(false)
    }
  }

  const positive = { validate: (v) => v === '' || Number(v) > 0 || 'Must be greater than zero.' }

  return (
    <ModalShell
      title={isEditMode ? 'Edit Category' : 'New Category'}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel={isEditMode ? 'Save Changes' : 'Add Category'}
      isSaving={isSaving}
      formError={formError}
    >
      <Field label="Name" error={errors.name}>
        <input {...register('name', { required: 'Name is required.', maxLength: { value: 100, message: 'Max 100 characters.' } })} className={inputClass} style={inputStyle} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Soft Limit (₹)" error={errors.softLimit} hint="Optional — warns the approver.">
          <input type="number" step="0.01" {...register('softLimit', positive)} className={`${inputClass} num`} style={inputStyle} />
        </Field>
        <Field label="Hard Limit (₹)" error={errors.hardLimit} hint="Optional — blocks submission.">
          <input
            type="number"
            step="0.01"
            {...register('hardLimit', {
              validate: (v, form) => {
                if (v === '') return true
                if (!(Number(v) > 0)) return 'Must be greater than zero.'
                if (form.softLimit !== '' && Number(form.softLimit) > Number(v)) return 'Must not be below the soft limit.'
                return true
              },
            })}
            className={`${inputClass} num`}
            style={inputStyle}
          />
        </Field>
      </div>
    </ModalShell>
  )
}
