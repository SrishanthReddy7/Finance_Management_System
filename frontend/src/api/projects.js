import { api } from './client'
import { unwrap } from './unwrap'

export async function listProjects({ status, billingModel, clientId, projectManagerId, employeeId, search, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (billingModel) params.billingModel = billingModel
  if (clientId) params.clientId = clientId
  if (projectManagerId) params.projectManagerId = projectManagerId
  if (employeeId) params.employeeId = employeeId
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/projects', { params })
  return unwrap(res)
}

export async function getProject(id) {
  const res = await api.get(`/projects/${id}`)
  return unwrap(res)
}

// Callers should expect this to reject with a 403 for a non-PM/non-Finance
// user -- that's the backend working as designed, not an error to swallow
// silently, but also not one to surface as a generic failure banner.
export async function getProjectProfitability(id) {
  const res = await api.get(`/projects/${id}/profitability`)
  return unwrap(res)
}

// --- Writes (all gated on MANAGE_PROJECTS by the backend) --------------------

export async function createProject(body) {
  const res = await api.post('/projects', body)
  return unwrap(res)
}

// `status` here goes through the backend's lifecycle guard; `comment` is the
// cancellation reason.
export async function updateProject(id, body) {
  const res = await api.patch(`/projects/${id}`, body)
  return unwrap(res)
}

export async function addMember(projectId, body) {
  const res = await api.post(`/projects/${projectId}/members`, body)
  return unwrap(res)
}

// There is no delete: ending an allocation means setting endDate.
export async function updateMember(projectId, memberId, body) {
  const res = await api.patch(`/projects/${projectId}/members/${memberId}`, body)
  return unwrap(res)
}

export async function addMilestone(projectId, body) {
  const res = await api.post(`/projects/${projectId}/milestones`, body)
  return unwrap(res)
}

export async function updateMilestone(projectId, milestoneId, body) {
  const res = await api.patch(`/projects/${projectId}/milestones/${milestoneId}`, body)
  return unwrap(res)
}
