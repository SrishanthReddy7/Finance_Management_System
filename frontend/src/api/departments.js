import { api } from './client'
import { unwrap } from './unwrap'

export async function listDepartments({ includeInactive } = {}) {
  const params = {}
  if (includeInactive != null) params.includeInactive = includeInactive
  const res = await api.get('/departments', { params })
  return unwrap(res)
}

export async function getDepartment(id) {
  const res = await api.get(`/departments/${id}`)
  return unwrap(res)
}

export async function createDepartment(body) {
  const res = await api.post('/departments', body)
  return unwrap(res)
}

export async function updateDepartment(id, body) {
  const res = await api.patch(`/departments/${id}`, body)
  return unwrap(res)
}

export async function setDepartmentStatus(id, isActive) {
  const res = await api.patch(`/departments/${id}/status`, { isActive })
  return unwrap(res)
}
