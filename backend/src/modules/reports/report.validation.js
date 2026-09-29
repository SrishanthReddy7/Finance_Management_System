// Zod layer for the generic Reports module (FRS Section 22, 29.9).
//
// Not .strict(): every schema here is a QUERY schema (GET requests only --
// Reports is read-only, Section 22 has no create/update shape), and query
// objects commonly carry framework-level keys (page/pageSize) alongside the
// filters a given report actually uses.
//
// `format` is shared by every report: `?format=csv` switches the response
// from the usual { success, data, error } envelope to a CSV file download
// (resolved with the user: build CSV now, skip PDF/Excel -- Section 22's own
// export-format line was marked unconfirmed).

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";
import { currency } from "../../utils/zodMoney.js";

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);
const currentYear = new Date().getUTCFullYear();

export const REPORT_FORMATS = ["json", "csv"];
const format = z.enum(REPORT_FORMATS).optional();

const periodYear = z.coerce.number().int().min(2000).max(currentYear + 1).optional();
const periodMonth = z.coerce.number().int().min(1).max(12).optional();

// ---------------------------------------------------------------------------
// Revenue / Expense / P&L (FRS 22 GREEN list)
// ---------------------------------------------------------------------------

export const revenueReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  clientId: uuid("clientId").optional(),
  projectId: uuid("projectId").optional(),
  currency: currency.optional(),
  format,
});

export const expenseReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: uuid("projectId").optional(),
  categoryId: uuid("categoryId").optional(),
  departmentId: uuid("departmentId").optional(),
  format,
});

export const profitLossQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  format,
});

// ---------------------------------------------------------------------------
// Salary Expense (FRS 22 GREEN list; access resolved with the user as
// VIEW_FINANCIAL_REPORTS OR VIEW_COMPANY_SALARY -- aggregate figures only,
// never a per-employee breakdown, so this never needs a per-row salary gate)
// ---------------------------------------------------------------------------

export const salaryExpenseReportQuerySchema = z.object({
  periodYear,
  periodMonth,
  departmentId: uuid("departmentId").optional(),
  format,
});

// ---------------------------------------------------------------------------
// Employee Reimbursement (FRS 22: "role-scoped like expenses", Section 8)
// ---------------------------------------------------------------------------

export const REIMBURSEMENT_STATUSES = ["PENDING", "PROCESSED", "PAID", "FAILED"];

export const reimbursementReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  employeeId: uuid("employeeId").optional(),
  departmentId: uuid("departmentId").optional(),
  status: z.enum(REIMBURSEMENT_STATUSES).optional(),
  format,
});

// ---------------------------------------------------------------------------
// Project Profitability (FRS 22 GREEN list; reuses project.service's own
// per-project profitability + visibility, this just lists across projects)
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

export const projectProfitabilityReportQuerySchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: uuid("clientId").optional(),
  projectManagerId: uuid("projectManagerId").optional(),
  format,
});

// ---------------------------------------------------------------------------
// Payment Transaction (FRS 22 GREEN list; ClientPayment + VendorPayment +
// Payslip payouts + (Stage 12) PROCESSED PaymentRefund rows, read-only union
// of already-recorded payments)
// ---------------------------------------------------------------------------

export const paymentTransactionReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  direction: z.enum(["IN", "OUT", "PAYROLL", "REFUND"]).optional(),
  currency: currency.optional(),
  format,
});

// ---------------------------------------------------------------------------
// Monthly Financial Summary / general financial summary (FRS 22 GREEN list)
// ---------------------------------------------------------------------------

export const financialSummaryQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  compare: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  format,
});

// ---------------------------------------------------------------------------
// Cash Flow Summary (FRS 22 GREEN list)
// ---------------------------------------------------------------------------

export const cashFlowReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  format,
});
