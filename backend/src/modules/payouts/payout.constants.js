// Payout domain constants (Payout Subsystem Step 2). Status transitions
// themselves are enforced as individual inline checks inside each
// payout.service.js function (approvePayout, rejectPayout, cancelPayout,
// submitPayoutToProvider, applyTerminalOutcome) rather than one central
// transition table -- closer to markPayslipPaid/recordPayment's
// leaf-level precondition style than payroll.service.js's own
// run-level STATUS_TRANSITIONS map. Every write to Payout.status is
// grep-confirmed confined to payout.service.js (verified: Step 3 audit).
// This file holds only the simpler lists other modules/layers need to
// import (validation enums, filters).

export const PAYOUT_PURPOSES = ["REIMBURSEMENT", "SALARY", "VENDOR_PAYMENT"];

// Live PayoutStatus enum, for query-filter validation.
export const PAYOUT_STATUSES = [
  "CREATED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "QUEUED",
  "PROCESSING",
  "PROCESSED",
  "REJECTED",
  "FAILED",
  "REVERSED",
  "CANCELLED",
];

// Same terminal set the schema's own PayoutStatus comment documents -- a
// webhook/sync event must never move a payout out of one of these.
export const TERMINAL_PAYOUT_STATUSES = ["PROCESSED", "FAILED", "REVERSED", "CANCELLED", "REJECTED"];

export const PAYOUT_ENTITY_TYPE = "Payout";
export const PAYOUT_ACCOUNT_ENTITY_TYPE = "EmployeePayoutAccount";
// Payout Subsystem Step 3C: AuditLog rows for a recorded PayoutReversal use
// this entity type + the PayoutReversal row's own id, mirroring the
// PaymentRefund precedent (its own audit rows use entityType "PaymentRefund"
// + the refund's own id, not ClientPayment's) rather than reusing
// PAYOUT_ENTITY_TYPE.
export const PAYOUT_REVERSAL_ENTITY_TYPE = "PayoutReversal";
