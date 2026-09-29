import { api } from './client'
import { unwrap } from './unwrap'

export async function listVendorBills({ status, vendorId, projectId, from, to, outstandingOnly, overdueOnly, search, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (vendorId) params.vendorId = vendorId
  if (projectId) params.projectId = projectId
  if (from) params.from = from
  if (to) params.to = to
  if (outstandingOnly != null) params.outstandingOnly = outstandingOnly
  if (overdueOnly != null) params.overdueOnly = overdueOnly
  if (search) params.search = search
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/vendor-bills', { params })
  return unwrap(res)
}

export async function getVendorBill(id) {
  const res = await api.get(`/vendor-bills/${id}`)
  return unwrap(res)
}

export async function listPayments(id) {
  const res = await api.get(`/vendor-bills/${id}/payments`)
  return unwrap(res)
}

export async function createVendorBill(body) {
  const res = await api.post('/vendor-bills', body)
  return unwrap(res)
}

export async function updateVendorBill(id, body) {
  const res = await api.patch(`/vendor-bills/${id}`, body)
  return unwrap(res)
}

export async function submitVendorBill(id, comment) {
  const res = await api.patch(`/vendor-bills/${id}/submit`, comment ? { comment } : {})
  return unwrap(res)
}

export async function verifyVendorBill(id, comment) {
  const res = await api.patch(`/vendor-bills/${id}/verify`, comment ? { comment } : {})
  return unwrap(res)
}

export async function sendVendorBillForApproval(id, comment) {
  const res = await api.patch(`/vendor-bills/${id}/send-for-approval`, comment ? { comment } : {})
  return unwrap(res)
}

export async function approveVendorBill(id, comment) {
  const res = await api.patch(`/vendor-bills/${id}/approve`, comment ? { comment } : {})
  return unwrap(res)
}

export async function rejectVendorBill(id, reason) {
  const res = await api.patch(`/vendor-bills/${id}/reject`, { reason })
  return unwrap(res)
}

export async function reopenVendorBill(id, comment) {
  const res = await api.patch(`/vendor-bills/${id}/reopen`, comment ? { comment } : {})
  return unwrap(res)
}

export async function cancelVendorBill(id, reason) {
  const res = await api.patch(`/vendor-bills/${id}/cancel`, { reason })
  return unwrap(res)
}

export async function recordPayment(id, body) {
  const res = await api.post(`/vendor-bills/${id}/payments`, body)
  return unwrap(res)
}

// FRS 22 "Vendor Payable" -- used only as a dashboard KPI data source in this
// step (Accounts Payable total, mirroring how the AR outstanding report was
// used in step 5); its own report page is deferred to the Reports hub (step 8).
export async function getPayableReport({ vendorId, projectId, from, to, asOf } = {}) {
  const params = {}
  if (vendorId) params.vendorId = vendorId
  if (projectId) params.projectId = projectId
  if (from) params.from = from
  if (to) params.to = to
  if (asOf) params.asOf = asOf
  const res = await api.get('/reports/ap/payable', { params })
  return unwrap(res)
}
