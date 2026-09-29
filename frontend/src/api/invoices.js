import { api } from './client'
import { unwrap } from './unwrap'

export async function listInvoices({
  status,
  clientId,
  projectId,
  milestoneId,
  from,
  to,
  outstandingOnly,
  overdueOnly,
  search,
  page,
  pageSize,
} = {}) {
  const params = {}
  if (status) params.status = status
  if (clientId) params.clientId = clientId
  if (projectId) params.projectId = projectId
  if (milestoneId) params.milestoneId = milestoneId
  if (from) params.from = from
  if (to) params.to = to
  if (outstandingOnly != null) params.outstandingOnly = outstandingOnly
  if (overdueOnly != null) params.overdueOnly = overdueOnly
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/invoices', { params })
  return unwrap(res)
}

export async function getInvoice(id) {
  const res = await api.get(`/invoices/${id}`)
  return unwrap(res)
}

export async function createInvoice(body) {
  const res = await api.post('/invoices', body)
  return unwrap(res)
}

export async function updateInvoice(id, body) {
  const res = await api.patch(`/invoices/${id}`, body)
  return unwrap(res)
}

export async function submitInvoice(id, comment) {
  const res = await api.patch(`/invoices/${id}/submit`, comment ? { comment } : {})
  return unwrap(res)
}

export async function approveInvoice(id, comment) {
  const res = await api.patch(`/invoices/${id}/approve`, comment ? { comment } : {})
  return unwrap(res)
}

export async function sendInvoice(id, comment) {
  const res = await api.patch(`/invoices/${id}/send`, comment ? { comment } : {})
  return unwrap(res)
}

export async function cancelInvoice(id, reason) {
  const res = await api.patch(`/invoices/${id}/cancel`, { reason })
  return unwrap(res)
}

export async function recordPayment(id, body) {
  const res = await api.post(`/invoices/${id}/payments`, body)
  return unwrap(res)
}

export async function listPayments(id) {
  const res = await api.get(`/invoices/${id}/payments`)
  return unwrap(res)
}

export async function getClientPaymentReport({ clientId, from, to } = {}) {
  const params = {}
  if (clientId) params.clientId = clientId
  if (from) params.from = from
  if (to) params.to = to
  const res = await api.get('/reports/ar/client-payments', { params })
  return unwrap(res)
}

export async function getOutstandingReport({ clientId, projectId, asOf } = {}) {
  const params = {}
  if (clientId) params.clientId = clientId
  if (projectId) params.projectId = projectId
  if (asOf) params.asOf = asOf
  const res = await api.get('/reports/ar/outstanding', { params })
  return unwrap(res)
}
