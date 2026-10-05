import { api } from './client';
import { unwrap } from './unwrap';

export async function listEmployeePayslips(employeeId, { periodYear, periodMonth, paymentStatus, status } = {}) {
  const params = {};
  if (periodYear) params.periodYear = periodYear;
  if (periodMonth) params.periodMonth = periodMonth;
  if (paymentStatus) params.paymentStatus = paymentStatus;
  if (status) params.status = status;
  const res = await api.get(`/employees/${employeeId}/payslips`, { params });
  return unwrap(res);
}

export async function getPayslip(id) {
  const res = await api.get(`/payslips/${id}`);
  return unwrap(res);
}
