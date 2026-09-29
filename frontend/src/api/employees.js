import { api } from './client'
import { unwrap } from './unwrap'

// The real Directory data source is GET /users (roleType-gated: SUPER_ADMIN
// or ADMIN-tier roles see the whole company, not a hierarchy-scoped slice --
// a deliberate backend MVP simplification, not something to narrow client-side).
export async function listUsers({ departmentId, page, pageSize } = {}) {
  const params = {}
  if (departmentId) params.departmentId = departmentId
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/users', { params })
  return unwrap(res)
}

export async function getEmployee(id) {
  const res = await api.get(`/employees/${id}`)
  return unwrap(res)
}

// Self or Super Admin only -- the backend 403s anyone else, including a peer
// Manager. Returns the FULL downward chain (flat array), not just direct reports.
export async function getSubordinates(id) {
  const res = await api.get(`/employees/${id}/subordinates`)
  return unwrap(res)
}

export async function updateEmployee(id, body) {
  const res = await api.patch(`/employees/${id}`, body)
  return unwrap(res)
}

// requireRoleType(SUPER_ADMIN, ADMIN) at the route -- same gate as the
// Directory itself, so anyone who can see /employees can also create one.
export async function createEmployee(body) {
  const res = await api.post('/users', body)
  return unwrap(res)
}

export async function setUserStatus(userId, status) {
  const res = await api.patch(`/users/${userId}/status`, { status })
  return unwrap(res)
}
