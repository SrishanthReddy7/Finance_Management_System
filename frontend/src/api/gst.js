import { api } from './client'
import { unwrap } from './unwrap'

export async function getConfig() {
  const res = await api.get('/gst/config')
  return unwrap(res)
}

export async function listTransactions({ direction, source, gstRate, from, to, page, pageSize } = {}) {
  const params = {}
  if (direction) params.direction = direction
  if (source) params.source = source
  if (gstRate != null) params.gstRate = gstRate
  if (from) params.from = from
  if (to) params.to = to
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/gst/transactions', { params })
  return unwrap(res)
}

export async function getTransaction(id) {
  const res = await api.get(`/gst/transactions/${id}`)
  return unwrap(res)
}

export async function getSummary({ from, to, periodYear } = {}) {
  const params = {}
  if (from) params.from = from
  if (to) params.to = to
  if (periodYear) params.periodYear = periodYear
  const res = await api.get('/gst/summary', { params })
  return unwrap(res)
}

export async function listPeriods({ status, periodYear, page, pageSize } = {}) {
  const params = {}
  if (status) params.status = status
  if (periodYear) params.periodYear = periodYear
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  const res = await api.get('/gst/periods', { params })
  return unwrap(res)
}

export async function getPeriodSummary(periodId) {
  const res = await api.get(`/gst/periods/${periodId}/summary`)
  return unwrap(res)
}

export async function createAdjustment(body) {
  const res = await api.post('/gst/transactions/adjustments', body)
  return unwrap(res)
}

export async function createPeriod(body) {
  const res = await api.post('/gst/periods', body)
  return unwrap(res)
}

export async function preparePeriod(periodId, status, comment) {
  const res = await api.patch(`/gst/periods/${periodId}/prepare`, { status, ...(comment ? { comment } : {}) })
  return unwrap(res)
}

export async function getFilingData(periodId) {
  const res = await api.get(`/gst/periods/${periodId}/filing-data`)
  return unwrap(res)
}

export async function markFiled(periodId, body) {
  const res = await api.patch(`/gst/periods/${periodId}/mark-filed`, body)
  return unwrap(res)
}

export async function acknowledgePeriod(periodId, body) {
  const res = await api.patch(`/gst/periods/${periodId}/acknowledge`, body)
  return unwrap(res)
}
