import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import * as projectsApi from '../../api/projects'
import * as clientsApi from '../../api/clients'
import { unwrapError } from '../../api/unwrap'
import { Field, ModalShell, inputClass, inputStyle, toDateInput, useEmployeeOptions } from './projectFormUi'

const BILLING_MODELS = [
  { value: 'MILESTONE', label: 'Milestone' },
  { value: 'FIXED_PRICE', label: 'Fixed Price' },
  { value: 'TIME_AND_MATERIAL', label: 'Time & Material' },
  { value: 'RETAINER', label: 'Retainer' },
]

// Mirrors the backend's lifecycle (project.service.js STATUS_TRANSITIONS) so
// the edit form only offers moves the server will accept.
const NEXT_STATUSES = {
  PLANNED: ['ACTIVE', 'ON_HOLD', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}
const CREATE_STATUSES = ['PLANNED', 'ACTIVE']

const label = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function ProjectFormModal({ project, onClose, onSaved }) {
  const isEditMode = !!project
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [clients, setClients] = useState([])
  const { options: people } = useEmployeeOptions()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: project?.name || '',
      clientId: project?.clientId || '',
      projectManagerId: project?.projectManagerId || '',
      billingModel: project?.billingModel || 'MILESTONE',
      contractValue: project?.contractValue != null ? String(project.contractValue) : '',
      startDate: toDateInput(project?.startDate),
      endDate: toDateInput(project?.endDate),
      status: project?.status || 'PLANNED',
      comment: '',
    },
  })

  useEffect(() => {
    clientsApi
      .listClients({ status: 'ACTIVE', pageSize: 100 })
      .then(({ rows }) => setClients(rows))
      .catch(() => setClients([]))
  }, [])

  const selectedStatus = watch('status')
  const statusChoices = isEditMode ? [project.status, ...NEXT_STATUSES[project.status]] : CREATE_STATUSES
  const isCancelling = isEditMode && selectedStatus === 'CANCELLED' && project.status !== 'CANCELLED'

  async function onSubmit(data) {
    setFormError('')
    setIsSaving(true)
    try {
      const contractValue = data.contractValue === '' ? null : Number(data.contractValue)
      if (isEditMode) {
        const body = {
          name: data.name.trim(),
          clientId: data.clientId,
          projectManagerId: data.projectManagerId || null,
          billingModel: data.billingModel,
          contractValue,
          startDate: data.startDate,
          endDate: data.endDate || null,
        }
        if (data.status !== project.status) {
          body.status = data.status
          if (data.comment.trim()) body.comment = data.comment.trim()
        }
        await projectsApi.updateProject(project.id, body)
      } else {
        await projectsApi.createProject({
          name: data.name.trim(),
          clientId: data.clientId,
          billingModel: data.billingModel,
          startDate: data.startDate,
          status: data.status,
          ...(data.projectManagerId ? { projectManagerId: data.projectManagerId } : {}),
          ...(contractValue != null ? { contractValue } : {}),
          ...(data.endDate ? { endDate: data.endDate } : {}),
        })
      }
      onSaved()
    } catch (err) {
      setFormError(unwrapError(err, 'Could not save this project.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell
      title={isEditMode ? 'Edit Project' : 'New Project'}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel={isEditMode ? 'Save Changes' : 'Create Project'}
      isSaving={isSaving}
      formError={formError}
    >
      <Field label="Project Name" error={errors.name}>
        <input {...register('name', { required: 'Project name is required.', maxLength: { value: 200, message: 'Max 200 characters.' } })} className={inputClass} style={inputStyle} />
      </Field>

      <Field label="Client" error={errors.clientId}>
        <select {...register('clientId', { required: 'Choose a client.' })} className={inputClass} style={inputStyle}>
          <option value="">Select a client…</option>
          {/* An edited project's client may since have gone inactive; keep it selectable. */}
          {isEditMode && project.client && !clients.some((c) => c.id === project.clientId) && (
            <option value={project.clientId}>{project.client.name}</option>
          )}
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Billing Model">
          <select {...register('billingModel', { required: true })} className={inputClass} style={inputStyle}>
            {BILLING_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Contract Value (₹)"
          error={errors.contractValue}
          hint="Optional"
        >
          <input
            type="number"
            step="0.01"
            min="0"
            {...register('contractValue', { min: { value: 0, message: 'Must not be negative.' } })}
            className={`${inputClass} num`}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Project Manager" hint="Optional. The PM sees this project's budget and profitability.">
        <select {...register('projectManagerId')} className={inputClass} style={inputStyle}>
          <option value="">No project manager</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Start Date" error={errors.startDate}>
          <input type="date" {...register('startDate', { required: 'Start date is required.' })} className={`${inputClass} num`} style={inputStyle} />
        </Field>
        <Field label="End Date" hint="Optional">
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

      <Field label="Status" hint={isEditMode && statusChoices.length === 1 ? 'This is a final status; it cannot be changed.' : undefined}>
        <select {...register('status')} disabled={isEditMode && statusChoices.length === 1} className={inputClass} style={inputStyle}>
          {statusChoices.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </Field>

      {isCancelling && (
        <Field label="Reason for cancelling (optional)">
          <input {...register('comment', { maxLength: 500 })} className={inputClass} style={inputStyle} />
        </Field>
      )}
    </ModalShell>
  )
}
