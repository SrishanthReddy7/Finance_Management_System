// Statuses counted as "actual spend" once Finance has signed off (mirrors
// the backend's ACTUAL_EXPENSE_STATUSES in expense.constants.js).
export const APPROVED_STATUSES = ['FINANCE_APPROVED', 'REIMBURSEMENT_PENDING', 'PARTIALLY_PAID', 'PAID']

const now = new Date()
const currentYear = now.getFullYear()
const currentMonth = now.getMonth()

export function isThisYear(dateStr) {
  return new Date(dateStr).getFullYear() === currentYear
}

export function isThisMonth(dateStr) {
  const d = new Date(dateStr)
  return d.getFullYear() === currentYear && d.getMonth() === currentMonth
}

// Shared by MyExpenses and the Employee dashboard so the two never drift.
export function computeExpenseStats(rows) {
  const pendingCount = rows.filter((c) => ['SUBMITTED', 'MANAGER_APPROVED'].includes(c.status)).length
  const approvedTotal = rows
    .filter((c) => APPROVED_STATUSES.includes(c.status) && isThisYear(c.expenseDate))
    .reduce((sum, c) => sum + Number(c.amount), 0)
  const reimbursedTotal = rows
    .filter((c) => c.status === 'PAID' && isThisYear(c.expenseDate))
    .reduce((sum, c) => sum + Number(c.amount), 0)
  return { pendingCount, approvedTotal, reimbursedTotal }
}
