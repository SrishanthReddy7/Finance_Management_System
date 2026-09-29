import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import StatusBadge from '../../components/ui/StatusBadge'
import ProgressBar from '../../components/ui/ProgressBar'
import { useAuth } from '../../context/AuthContext'
import { buildNavItems } from '../../routes/navConfig'
import * as projectsApi from '../../api/projects'
import { unwrapError } from '../../api/unwrap'
import { formatCurrency, formatDate } from '../../utils/format'
import ProjectFormModal from './ProjectFormModal'
import MemberFormModal from './MemberFormModal'
import MilestoneFormModal from './MilestoneFormModal'

export default function ProjectDetail() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const navItems = buildNavItems(user, can)

  const [project, setProject] = useState(null)
  const [profitability, setProfitability] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  // One modal at a time: { type: 'project' | 'member' | 'milestone', item? }
  const [modal, setModal] = useState(null)
  const canManage = can('MANAGE_PROJECTS')
  // Closed projects take no new allocations or milestones (backend rule).
  const isClosed = project?.status === 'COMPLETED' || project?.status === 'CANCELLED'

  function handleSaved() {
    setModal(null)
    setReloadKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    projectsApi
      .getProject(id)
      .then((data) => {
        if (cancelled) return
        setProject(data)
        // A 403 here is expected for a non-PM/non-Finance viewer -- not an
        // error, just "this section isn't for you."
        return projectsApi
          .getProjectProfitability(id)
          .then((p) => {
            if (!cancelled) setProfitability(p)
          })
          .catch(() => {})
      })
      .catch((err) => {
        if (!cancelled) setError(unwrapError(err, 'Could not load this project.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  return (
    <AppShell navItems={navItems} title="Project Detail" subtitle="Budget, milestones, team members and profitability for this project.">
      <div className="flex flex-col gap-6">
        <Link to="/projects" className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={15} /> Back to Projects
        </Link>

        {error && (
          <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Loading…
          </p>
        ) : project ? (
          <>
            <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {project.name}
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {project.client?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={project.status} entity="project" />
                  {canManage && (
                    <button type="button" onClick={() => setModal({ type: 'project' })} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                      Edit
                    </button>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-4 gap-4 text-[13px]">
                <Field label="Billing Model">{project.billingModel.replace(/_/g, ' ')}</Field>
                <Field label="Project Manager">
                  {project.projectManager ? `${project.projectManager.firstName} ${project.projectManager.lastName}` : '—'}
                </Field>
                <Field label="Contract Value">
                  <span className="num">{project.contractValue != null ? formatCurrency(project.contractValue) : '—'}</span>
                </Field>
                <Field label="Timeline">
                  <span className="num">
                    {formatDate(project.startDate)} – {project.endDate ? formatDate(project.endDate) : 'Ongoing'}
                  </span>
                </Field>
              </dl>

              {project.progress && (
                <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span style={{ color: 'var(--ink-muted)' }}>Milestone Progress</span>
                    <span className="num" style={{ color: 'var(--ink-muted)' }}>
                      {project.progress.completedMilestoneCount} of {project.progress.milestoneCount}
                      {project.progress.isOverdue && (
                        <span style={{ color: 'var(--danger)' }}> · Overdue</span>
                      )}
                    </span>
                  </div>
                  <ProgressBar value={project.progress.completedMilestoneCount} max={project.progress.milestoneCount || 1} />
                </div>
              )}
            </div>

            {profitability && (
              <div>
                <h3 className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                  Profitability
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  <StatCard label="Revenue Billed" value={formatCurrency(profitability.revenue.billed)} />
                  <StatCard label="Total Cost" value={formatCurrency(profitability.cost.total)} />
                  <StatCard
                    label="Profit"
                    value={formatCurrency(profitability.profitability.profit)}
                    color={profitability.profitability.profit >= 0 ? 'var(--success)' : 'var(--danger)'}
                  />
                  <StatCard
                    label="Margin"
                    value={profitability.profitability.marginPercent != null ? `${profitability.profitability.marginPercent.toFixed(0)}%` : '—'}
                    color={
                      profitability.profitability.marginPercent != null && profitability.profitability.marginPercent >= 0
                        ? 'var(--success)'
                        : 'var(--danger)'
                    }
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                    Team ({project.members?.length || 0})
                  </h3>
                  {canManage && !isClosed && (
                    <button type="button" onClick={() => setModal({ type: 'member' })} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                      + Allocate member
                    </button>
                  )}
                </div>
                <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {project.members?.length ? (
                    project.members.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div>
                          <div style={{ color: 'var(--ink)' }}>
                            {m.employee.firstName} {m.employee.lastName}
                          </div>
                          <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                            {m.employee.designation}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="num" style={{ color: 'var(--ink-muted)' }}>
                            {m.allocationPercent}%
                            {m.endDate && <span className="text-[12px]"> · ends {formatDate(m.endDate)}</span>}
                          </span>
                          {canManage && (
                            <button type="button" onClick={() => setModal({ type: 'member', item: m })} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="p-4 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                      No members allocated yet.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                    Milestones ({project.milestones?.length || 0})
                  </h3>
                  {canManage && !isClosed && (
                    <button type="button" onClick={() => setModal({ type: 'milestone' })} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                      + Add milestone
                    </button>
                  )}
                </div>
                <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {project.milestones?.length ? (
                    project.milestones.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between border-b px-4 py-3 text-[13px] last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div>
                          <div style={{ color: 'var(--ink)' }}>{m.name}</div>
                          {m.dueDate && (
                            <div className="num text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                              Due {formatDate(m.dueDate)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {m.amount != null && <span className="num" style={{ color: 'var(--ink-muted)' }}>{formatCurrency(m.amount)}</span>}
                          <StatusBadge status={m.status} entity="milestone" />
                          {canManage && (
                            <button type="button" onClick={() => setModal({ type: 'milestone', item: m })} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="p-4 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                      No milestones yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {modal?.type === 'project' && <ProjectFormModal project={project} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.type === 'member' && <MemberFormModal project={project} member={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.type === 'milestone' && <MilestoneFormModal project={project} milestone={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />}
    </AppShell>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </dt>
      <dd style={{ color: 'var(--ink)' }}>{children}</dd>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="num mt-2 text-[22px] font-bold" style={{ color: color || 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}
