import { useEffect, useState } from 'react'
import * as expensesApi from '../../api/expenses'
import { isThisMonth } from '../../utils/expenseStats'

const AWAITING_PAYMENT_STATUSES = ['FINANCE_APPROVED', 'REIMBURSEMENT_PENDING']

/**
 * Shared by Team Lead and Manager dashboards: one fetch scoped by the
 * backend to "this reviewer's reviewable team, own claims excluded" (the
 * same visibility rule the manager queue in ExpenseApprovals.jsx uses),
 * with every derived number computed from that single result set so the
 * two dashboards can never drift from each other or from the Approvals page.
 */
export function useTeamExpenseSummary(user) {
  const [teamRows, setTeamRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    expensesApi
      .listClaims({ pageSize: 100 })
      .then(({ rows }) => {
        if (cancelled) return
        setTeamRows(rows.filter((row) => row.employeeId !== user?.employee?.id))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your team’s expenses.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.employee?.id])

  const pendingApprovalRows = teamRows.filter((c) => c.status === 'SUBMITTED')
  const awaitingPaymentCount = teamRows.filter((c) => AWAITING_PAYMENT_STATUSES.includes(c.status)).length
  const thisMonthTotal = teamRows
    .filter((c) => isThisMonth(c.expenseDate))
    .reduce((sum, c) => sum + Number(c.amount), 0)

  return { isLoading, error, teamRows, pendingApprovalRows, awaitingPaymentCount, thisMonthTotal }
}
