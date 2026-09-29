// Expense-claim status groupings that other modules need.
//
// A separate file, not an export from expense.service.js, for the same reason
// vendorBill.constants.js exists: a module that only needs "which statuses
// count as actual spend" (project.service.js, budget.service.js) should not
// have to import the whole expense workflow. Extracted from project.service.js,
// which previously defined these two arrays locally -- moved here so the
// Budgets module can reuse the exact same classification instead of a second
// copy that could drift from it.

/**
 * FRS 19 / Section 26 rule 10: "actual spend" is computed, never entered. A
 * claim becomes actual spend once Finance has approved it -- anything earlier
 * is a commitment, and a DRAFT is not even that.
 */
export const ACTUAL_EXPENSE_STATUSES = ["FINANCE_APPROVED", "REIMBURSEMENT_PENDING", "PARTIALLY_PAID", "PAID"];

/** In the workflow but not yet Finance-approved: a commitment, reported separately. */
export const PENDING_EXPENSE_STATUSES = ["SUBMITTED", "MANAGER_APPROVED"];
