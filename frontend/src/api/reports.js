import { api } from './client'
import { unwrap } from './unwrap'

async function get(path, params) {
  const res = await api.get(path, { params })
  return unwrap(res)
}

export const getRevenue = ({ from, to, clientId, projectId, currency } = {}) =>
  get('/reports/revenue', { from, to, clientId, projectId, currency })

export const getExpenses = ({ from, to, projectId, categoryId, departmentId } = {}) =>
  get('/reports/expenses', { from, to, projectId, categoryId, departmentId })

export const getProfitLoss = ({ from, to } = {}) => get('/reports/profit-loss', { from, to })

export const getSalaryExpense = ({ periodYear, periodMonth, departmentId } = {}) =>
  get('/reports/salary-expense', { periodYear, periodMonth, departmentId })

export const getEmployeeReimbursement = ({ from, to, employeeId, departmentId, status } = {}) =>
  get('/reports/employee-reimbursement', { from, to, employeeId, departmentId, status })

export const getProjectProfitability = ({ status, clientId, projectManagerId, page, pageSize } = {}) =>
  get('/reports/project-profitability', { status, clientId, projectManagerId, page, pageSize })

export const getPaymentTransactions = ({ from, to, direction, currency } = {}) =>
  get('/reports/payment-transactions', { from, to, direction, currency })

export const getFinancialSummary = ({ from, to, compare } = {}) =>
  get('/reports/financial-summary', { from, to, compare })

export const getCashFlow = ({ from, to } = {}) => get('/reports/cash-flow', { from, to })
