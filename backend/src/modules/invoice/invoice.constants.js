// Invoice status groupings that other modules need.
//
// A separate file, not an export from invoice.service.js, mirroring
// vendorBill.constants.js / expense.constants.js: a module that only needs
// "which statuses count as billed revenue" (Projects, Reports) should not
// have to import the whole invoicing workflow.

/**
 * FRS 13.4 "Project Revenue = sum of Paid + Sent invoice amounts". PARTIALLY_PAID
 * sits between Sent and Paid on the Section 14.2 lifecycle, and Section 38 Q26
 * confirms partial payments are real, so it counts as billed revenue too.
 *
 * OVERDUE is in this list because it is a payment-timing state, not a billing
 * state: an invoice the client has not paid on time is still invoiced revenue.
 * Leaving it out would make billed revenue silently fall every time a due date
 * passed.
 */
export const REVENUE_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"];
