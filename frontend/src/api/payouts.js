import { api } from './client'
import { unwrap } from './unwrap'

export async function listPayouts({ status, purpose, vendorBillId, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (purpose) params.purpose = purpose
  if (vendorBillId) params.vendorBillId = vendorBillId
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/payouts', { params })
  return unwrap(res)
}

export async function getPayout(id) {
  const res = await api.get(`/payouts/${id}`)
  return unwrap(res)
}

// The one creation path in scope this step: initiating a vendor payout
// against an already-approved (or partially paid) vendor bill.
export async function createVendorPayout(vendorBillId, body = {}) {
  const res = await api.post(`/payouts/vendor-bills/${vendorBillId}`, body)
  return unwrap(res)
}

export async function approvePayout(id) {
  const res = await api.patch(`/payouts/${id}/approve`)
  return unwrap(res)
}

export async function rejectPayout(id, reason) {
  const res = await api.patch(`/payouts/${id}/reject`, { reason })
  return unwrap(res)
}

export async function cancelPayout(id, reason) {
  const res = await api.patch(`/payouts/${id}/cancel`, { reason })
  return unwrap(res)
}

export async function retryPayout(id) {
  const res = await api.patch(`/payouts/${id}/retry`)
  return unwrap(res)
}

// Not in the original spec's endpoint table, but load-bearing: nothing else
// advances a MOCK-provider payout out of QUEUED/PROCESSING (no webhook, no
// background job here), so without this the UI would show a payout stuck
// forever. Same requirePayoutOperate gate the backend uses (INITIATE_PAYOUT
// or APPROVE_PAYOUT).
export async function syncPayout(id) {
  const res = await api.patch(`/payouts/${id}/sync`)
  return unwrap(res)
}
