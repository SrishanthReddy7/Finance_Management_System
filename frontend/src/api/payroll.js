import { api } from './client'
import { unwrap } from './unwrap'

export async function listRuns({ status, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/payroll/runs', { params })
  return unwrap(res)
}

export async function getRun(id) {
  const res = await api.get(`/payroll/runs/${id}`)
  return unwrap(res)
}

export async function createRun(body) {
  const res = await api.post('/payroll/runs', body)
  return unwrap(res)
}

export async function processRun(id) {
  const res = await api.patch(`/payroll/runs/${id}/process`)
  return unwrap(res)
}

export async function finalizeRun(id, comment) {
  const res = await api.patch(`/payroll/runs/${id}/finalize`, comment ? { comment } : {})
  return unwrap(res)
}

export async function rejectRun(id, reason) {
  const res = await api.patch(`/payroll/runs/${id}/reject`, { reason })
  return unwrap(res)
}

export async function cancelRun(id, reason) {
  const res = await api.patch(`/payroll/runs/${id}/cancel`, { reason })
  return unwrap(res)
}

export async function markPayslipPaid(runId, payslipId, body) {
  const res = await api.patch(`/payroll/runs/${runId}/payslips/${payslipId}/mark-paid`, body)
  return unwrap(res)
}

export async function markPayslipFailed(runId, payslipId, reason) {
  const res = await api.patch(`/payroll/runs/${runId}/payslips/${payslipId}/mark-failed`, { reason })
  return unwrap(res)
}

// Hierarchy-gated same as salary structure (404, not 403, when denied).
export async function listEmployeePayslips(employeeId, { periodYear } = {}) {
  const params = {}
  if (periodYear) params.periodYear = periodYear
  const res = await api.get(`/employees/${employeeId}/payslips`, { params })
  return unwrap(res)
}

export async function getPayslip(id) {
  const res = await api.get(`/payslips/${id}`)
  return unwrap(res)
}
