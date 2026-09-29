import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as projectsApi from '../../api/projects'
import { unwrapError } from '../../api/unwrap'
import { Field, ModalShell, inputClass, inputStyle, toDateInput, useEmployeeOptions } from './projectFormUi'

// Add (member omitted) or edit (member given) one allocation. The backend has
// no delete: an allocation is ended by setting its end date, which keeps the
// past cost contribution in profitability intact.
export default function MemberFormModal({ project, member, onClose, onSaved }) {
  const isEditMode = !!member
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const { options: people } = useEmployeeOptions()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      employeeId: '',
      allocationPercent: member ? String(member.allocationPercent) : '100',
      startDate: toDateInput(member?.startDate || project.startDate),
      endDate: toDateInput(member?.endDate),
    },
  })

  const alreadyAllocated = new Set((project.members || []).map((m) => m.employeeId))

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const allocationPercent = Number(data.allocationPercent)
      if (isEditMode) {
        await projectsApi.updateMember(project.id, member.id, {
          allocationPercent,
          startDate: data.startDate,
          endDate: data.endDate || null,
        })
      } else {
        await projectsApi.addMember(project.id, {
          employeeId: data.employeeId,
          allocationPercent,
          startDate: data.startDate,
          ...(data.endDate ? { endDate: data.endDate } : {}),
        })
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this allocation.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell
      title={isEditMode ? `Edit Allocation — ${member.employee.firstName} ${member.employee.lastName}` : 'Allocate Team Member'}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel={isEditMode ? 'Save Changes' : 'Allocate'}
      isSaving={isSaving}
      formError={formError}
    >
      {!isEditMode && (
        <Field label="Employee" error={errors.employeeId}>
          <select {...register('employeeId', { required: 'Choose an employee.' })} className={inputClass} style={inputStyle}>
            <option value="">Select an employee…</option>
            {people
              .filter((p) => !alreadyAllocated.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </select>
        </Field>
      )}

      <Field label="Allocation (%)" error={errors.allocationPercent} hint="Share of this person's time on the project; drives the labour-cost side of profitability.">
        <input
          type="number"
          step="1"
          {...register('allocationPercent', {
            required: 'Enter a percentage.',
            min: { value: 1, message: 'At least 1%.' },
            max: { value: 100, message: 'At most 100%.' },
            validate: (v) => Number.isInteger(Number(v)) || 'Use a whole number.',
          })}
          className={`${inputClass} num`}
          style={inputStyle}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Start Date" error={errors.startDate}>
          <input type="date" {...register('startDate', { required: 'Start date is required.' })} className={`${inputClass} num`} style={inputStyle} />
        </Field>
        <Field label="End Date" hint={isEditMode ? 'Set this to end the allocation.' : 'Optional'}>
          <input
            type="date"
            {...register('endDate', {
              validate: (v, form) => !v || !form.startDate || v >= form.startDate || 'End date must be on or after the start date.',
            })}
            className={`${inputClass} num`}
            style={inputStyle}
          />
          {errors.endDate && (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--danger)' }}>
              {errors.endDate.message}
            </p>
          )}
        </Field>
      </div>
    </ModalShell>
  )
}
