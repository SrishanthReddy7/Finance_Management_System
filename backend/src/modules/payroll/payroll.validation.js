// Zod layer for Payroll (FRS Section 12, 26, 27, 29.3), extended with the
// maker-checker approval workflow.
//
// Schemas are .strict(): an unknown key is a clean 400. There is no field
// anywhere in this file for grossEarnings/totalDeductions/netSalary/status on
// a payslip, or for a payroll run's totals -- Section 26 rule 10 makes all of
// that computed server-side from the salary structure in force, never
// accepted from a client.
//
// Salary-structure validation (FRS 29.3 PUT /employees/:id/salary-structure)
// lives in the Salaries module now -- employeeIdParamSchema is re-exported
// from there rather than duplicated, since GET /employees/:id/payslips below
// still needs the same :id param shape.

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";

export { employeeIdParamSchema } from "../salaries/salary.validation.js";

export const PAYROLL_RUN_STATUSES = ["DRAFT", "PROCESSED", "FINALIZED", "PAID", "CANCELLED"];
// FRS Section 38 Q14 (answered): the same two methods reimbursements use.
// Salary payout shares the same payment vocabulary (Section 20).
export const PAYMENT_METHODS = ["BANK_TRANSFER", "PETTY_CASH", "CHEQUE", "OTHER"];

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);
const reason = z.string().trim().min(1, "A reason is required.").max(500);
const currentYear = new Date().getUTCFullYear();

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export const createPayrollRunSchema = z
  .object({
    periodMonth: z.number().int().min(1, "periodMonth must be 1-12.").max(12, "periodMonth must be 1-12."),
    // FRS gives no bound; a sane floor/ceiling catches a typo'd year (e.g.
    // sending a month number in the year field) without hardcoding a rule the
    // FRS never states.
    periodYear: z.number().int().min(2000).max(currentYear + 1),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const payrollRunIdParamSchema = z.object({ id: uuid("Payroll run id") });

export const listPayrollRunsQuerySchema = z.object({
  status: z.enum(PAYROLL_RUN_STATUSES).optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
  periodYear: z.coerce.number().int().min(2000).max(currentYear + 1).optional(),
});

// process/finalize/reject/cancel all take just an optional note, except
// reject/cancel where FRS Section 24 makes the reason mandatory (an audited
// REJECT/CANCEL entry nobody can explain is the one an auditor asks about).
export const runActionSchema = z
  .object({
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const runReasonSchema = z.object({ reason }).strict();

// ---------------------------------------------------------------------------
// Payslip payment (FRS Section 20's payment shape, applied to payroll)
// ---------------------------------------------------------------------------

export const markPayslipPaidSchema = z
  .object({
    paymentDate: isoDate.optional(), // defaults to today in the service
    method: z.enum(PAYMENT_METHODS),
    referenceNo: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const markPayslipFailedSchema = z.object({ reason }).strict();

export const payslipIdParamSchema = z.object({ id: uuid("Payslip id") });

export const listPayslipsQuerySchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(currentYear + 1).optional(),
});
