import { api } from './client'
import { unwrap } from './unwrap'

// includeInactive is only honoured for Finance / Super Admin (category management).
export async function listCategories({ includeInactive } = {}) {
  const res = await api.get('/expenses/categories', { params: includeInactive ? { includeInactive: true } : {} })
  return unwrap(res)
}

// Finance / Super Admin only (VERIFY_EXPENSE). softLimit warns the approver,
// hardLimit blocks submission; null clears a limit on update.
export async function createCategory(body) {
  const res = await api.post('/expenses/categories', body)
  return unwrap(res)
}

export async function updateCategory(id, body) {
  const res = await api.patch(`/expenses/categories/${id}`, body)
  return unwrap(res)
}

export async function createClaim(body) {
  const res = await api.post('/expenses', body)
  return unwrap(res)
}

export async function updateClaim(id, body) {
  const res = await api.patch(`/expenses/${id}`, body)
  return unwrap(res)
}

export async function getClaim(id) {
  const res = await api.get(`/expenses/${id}`)
  return unwrap(res)
}

// { rows, meta: { page, pageSize, totalCount, totalPages } }
export async function listClaims({ status, projectId, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (projectId) params.projectId = projectId
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/expenses', { params })
  return unwrap(res)
}

export async function submitClaim(id) {
  const res = await api.post(`/expenses/${id}/submit`)
  return unwrap(res)
}

export async function cancelClaim(id, comment) {
  const res = await api.patch(`/expenses/${id}/cancel`, comment ? { comment } : {})
  return unwrap(res)
}

export async function addReceipt(id, file) {
  const formData = new FormData()
  formData.append('receipt', file)
  const res = await api.post(`/expenses/${id}/receipts`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return unwrap(res)
}

// The download endpoint is protected -- a plain <a href>/<img src> can't
// attach the Bearer token, so fetch it as a blob and hand the caller an
// object URL to open/download.
export async function getReceiptObjectUrl(claimId, receiptId) {
  const res = await api.get(`/expenses/${claimId}/receipts/${receiptId}`, { responseType: 'blob' })
  return URL.createObjectURL(res.data)
}

export async function managerReview(id, decision, comment) {
  const norm = decision === 'APPROVED' ? 'APPROVE' : (decision === 'REJECTED' ? 'REJECT' : decision)
  const res = await api.patch(`/expenses/${id}/manager-review`, { decision: norm, comment })
  return unwrap(res)
}

export async function financeReview(id, decision, comment) {
  const norm = decision === 'APPROVED' ? 'APPROVE' : (decision === 'REJECTED' ? 'REJECT' : decision)
  const res = await api.patch(`/expenses/${id}/finance-review`, { decision: norm, comment })
  return unwrap(res)
}

// Finance records that the claim's reimbursement has been paid out (FRS 11.1
// steps 7-8). method is BANK_TRANSFER or PETTY_CASH (FRS Section 38 Q14).
export async function processReimbursement(id, { method, referenceNo }) {
  const res = await api.post(`/expenses/${id}/reimbursement`, { method, ...(referenceNo ? { referenceNo } : {}) })
  return unwrap(res)
}
