import { api } from './client'
import { unwrap } from './unwrap'

export async function listAuditLogs({ entityType, entityId, performedById, from, to, page, pageSize } = {}) {
  const params = {}
  if (entityType) params.entityType = entityType
  if (entityId) params.entityId = entityId
  if (performedById) params.performedById = performedById
  if (from) params.from = from
  if (to) params.to = to
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/audit-logs', { params })
  return unwrap(res)
}
