import { api } from './client'
import { unwrap } from './unwrap'

export async function listBudgets({ scope, status, departmentId, projectId, search, page, pageSize } = {}) {
  const params = {}
  if (scope) params.scope = scope
  if (status) params.status = status
  if (departmentId) params.departmentId = departmentId
  if (projectId) params.projectId = projectId
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/budgets', { params })
  return unwrap(res)
}

export async function getBudget(id) {
  const res = await api.get(`/budgets/${id}`)
  return unwrap(res)
}

export async function getUtilization(id) {
  const res = await api.get(`/budgets/${id}/utilization`)
  return unwrap(res)
}

export async function createBudget(body) {
  const res = await api.post('/budgets', body)
  return unwrap(res)
}

export async function updateBudget(id, body) {
  const res = await api.patch(`/budgets/${id}`, body)
  return unwrap(res)
}

export async function setBudgetStatus(id, status, comment) {
  const res = await api.patch(`/budgets/${id}/status`, { status, ...(comment ? { comment } : {}) })
  return unwrap(res)
}

// Gated flatly on VIEW_FINANCIAL_REPORTS (unlike the in-service-scoped plain
// list) -- a PM-only Manager can't use this one, so it's only used where
// that permission is already confirmed.
export async function getBudgetSummary({ scope, status, departmentId, projectId } = {}) {
  const params = {}
  if (scope) params.scope = scope
  if (status) params.status = status
  if (departmentId) params.departmentId = departmentId
  if (projectId) params.projectId = projectId
  const res = await api.get('/reports/budgets/summary', { params })
  return unwrap(res)
}
