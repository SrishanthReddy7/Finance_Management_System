import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as projectsApi from '../../api/projects'
import { unwrapError } from '../../api/unwrap'
import { Field, ModalShell, inputClass, inputStyle, toDateInput } from './projectFormUi'

const STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

// Add (milestone omitted) or edit one milestone. Milestone is the billing
// model the client actually uses (FRS Section 38 Q22), and completing one is
// what lets Finance invoice it.
export default function MilestoneFormModal({ project, milestone, onClose, onSaved }) {
  const isEditMode = !!milestone
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: milestone?.name || '',
      description: milestone?.description || '',
      amount: milestone?.amount != null ? String(milestone.amount) : '',
      dueDate: toDateInput(milestone?.dueDate),
      status: milestone?.status || 'PENDING',
    },
  })

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const amount = data.amount === '' ? null : Number(data.amount)
      if (isEditMode) {
        await projectsApi.updateMilestone(project.id, milestone.id, {
          name: data.name.trim(),
          description: data.description.trim() || null,
          amount,
          dueDate: data.dueDate || null,
          status: data.status,
        })
      } else {
        await projectsApi.addMilestone(project.id, {
          name: data.name.trim(),
          ...(data.description.trim() ? { description: data.description.trim() } : {}),
          ...(amount != null ? { amount } : {}),
          ...(data.dueDate ? { dueDate: data.dueDate } : {}),
        })
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this milestone.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell
      title={isEditMode ? 'Edit Milestone' : 'New Milestone'}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel={isEditMode ? 'Save Changes' : 'Add Milestone'}
      isSaving={isSaving}
      formError={formError}
    >
      <Field label="Name" error={errors.name}>
        <input {...register('name', { required: 'Milestone name is required.', maxLength: { value: 200, message: 'Max 200 characters.' } })} className={inputClass} style={inputStyle} />
      </Field>

      <Field label="Description" hint="Optional">
        <textarea rows={2} {...register('description', { maxLength: { value: 1000, message: 'Max 1000 characters.' } })} className={inputClass} style={inputStyle} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (₹)" error={errors.amount} hint="Optional — the amount billed on completion.">
          <input
            type="number"
            step="0.01"
            min="0"
            {...register('amount', { min: { value: 0, message: 'Must not be negative.' } })}
            className={`${inputClass} num`}
            style={inputStyle}
          />
        </Field>
        <Field label="Due Date" hint={`Optional. Not before ${toDateInput(project.startDate)}.`}>
          <input type="date" {...register('dueDate')} className={`${inputClass} num`} style={inputStyle} />
        </Field>
      </div>

      {isEditMode && (
        <Field label="Status">
          <select {...register('status')} className={inputClass} style={inputStyle}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}
    </ModalShell>
  )
}
