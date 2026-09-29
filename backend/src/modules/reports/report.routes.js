// Generic Reports module (FRS Section 22, 29.9).
//
// Mounted at "/reports", AFTER /reports/ar, /reports/ap, /reports/gst and
// /reports/budgets in the central route index -- those own more specific
// paths under the same prefix (Client Outstanding, Invoice Aging, Vendor
// Payable, GST report/filing, Budget vs Actual) and must keep matching
// first. This router only ever adds the report names NOT already served by
// another module -- see report.service.js's header comment for the full map.

import { Router } from "express";
import {
  revenueReportHandler,
  expenseReportHandler,
  profitLossReportHandler,
  salaryExpenseReportHandler,
  reimbursementReportHandler,
  projectProfitabilityReportHandler,
  paymentTransactionReportHandler,
  financialSummaryReportHandler,
  cashFlowReportHandler,
} from "./report.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

const router = Router();
router.use(authenticate);

/**
 * FRS Section 22's own access table is marked "confirm" for most rows; every
 * report already built (AR/AP/GST/Budget) settled on one flat
 * VIEW_FINANCIAL_REPORTS gate, and the company-wide reports here follow that
 * same convention. Salary Expense is the one exception, resolved with the
 * user: the FRS explicitly suggests "Super Admin, HR Admin" for it, and HR
 * Admin holds VIEW_COMPANY_SALARY but not VIEW_FINANCIAL_REPORTS -- so this
 * report accepts either. It still only ever returns aggregate figures (see
 * report.service.js), so this does not widen individual salary exposure.
 */
function requireSalaryExpenseAccess(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (codes.includes("VIEW_FINANCIAL_REPORTS") || codes.includes("VIEW_COMPANY_SALARY")) return next();
  return fail(res, 403, "Missing required permission: one of VIEW_FINANCIAL_REPORTS, VIEW_COMPANY_SALARY");
}

router.get("/revenue", requirePermission("VIEW_FINANCIAL_REPORTS"), revenueReportHandler);
router.get("/expenses", requirePermission("VIEW_FINANCIAL_REPORTS"), expenseReportHandler);
router.get("/profit-loss", requirePermission("VIEW_FINANCIAL_REPORTS"), profitLossReportHandler);
router.get("/salary-expense", requireSalaryExpenseAccess, salaryExpenseReportHandler);

// FRS 22: "Employee Reimbursement | ... | Role-scoped like expenses (Section
// 8 pattern)". No permission gate here, same convention as GET /expenses --
// visibility is scoped inside the service (Finance/Super Admin see
// everything, an approving manager sees their reviewable hierarchy, everyone
// else sees only their own reimbursements).
router.get("/employee-reimbursement", reimbursementReportHandler);

// FRS 22: "Project Profitability | ... | Super Admin, assigned Project
// Manager/Admin". No blanket permission gate -- the exact same narrow rule
// GET /projects/:id/profitability uses (VIEW_FINANCIAL_REPORTS or the
// project's own assigned manager) is applied per-project inside the service.
router.get("/project-profitability", projectProfitabilityReportHandler);

router.get("/payment-transactions", requirePermission("VIEW_FINANCIAL_REPORTS"), paymentTransactionReportHandler);
router.get("/financial-summary", requirePermission("VIEW_FINANCIAL_REPORTS"), financialSummaryReportHandler);
router.get("/cash-flow", requirePermission("VIEW_FINANCIAL_REPORTS"), cashFlowReportHandler);

export default router;
