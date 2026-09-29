import { api } from './client'
import { unwrap } from './unwrap'

export async function listClients({ status, search, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/clients', { params })
  return unwrap(res)
}

export async function getClient(id) {
  const res = await api.get(`/clients/${id}`)
  return unwrap(res)
}

export async function createClient(body) {
  const res = await api.post('/clients', body)
  return unwrap(res)
}

export async function updateClient(id, body) {
  const res = await api.patch(`/clients/${id}`, body)
  return unwrap(res)
}
