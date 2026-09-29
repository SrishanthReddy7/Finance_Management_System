import { api } from './client'
import { unwrap } from './unwrap'

export async function listVendors({ status, search, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/vendors', { params })
  return unwrap(res)
}

export async function getVendor(id) {
  const res = await api.get(`/vendors/${id}`)
  return unwrap(res)
}

export async function createVendor(body) {
  const res = await api.post('/vendors', body)
  return unwrap(res)
}

export async function updateVendor(id, body) {
  const res = await api.patch(`/vendors/${id}`, body)
  return unwrap(res)
}
