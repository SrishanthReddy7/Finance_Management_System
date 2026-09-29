import { Router } from "express";
import {
  listEmployeePayslipsHandler,
  getPayslipHandler,
  listPayrollRunsHandler,
  getPayrollRunHandler,
  createPayrollRunHandler,
  processPayrollRunHandler,
  finalizePayrollRunHandler,
  rejectPayrollRunHandler,
  cancelPayrollRunHandler,
  markPayslipPaidHandler,
  markPayslipFailedHandler,
} from "./payroll.controller.js";
import { getPayslipEmployeeId } from "./payroll.service.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission, requireSalaryAccess } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

// ---------------------------------------------------------------------------
// Read gate for payroll runs: MANAGE_SALARY (preparer), APPROVE_PAYROLL
// (approver) or VIEW_FINANCIAL_REPORTS (Finance's reporting override) --
// requirePermission takes a single code, and this is an OR across three, so
// the gate is composed here, the same place vendor bills compose
// requireBillReview and vendors composes requireVendorRead.
// ---------------------------------------------------------------------------
const RUN_READ_PERMISSIONS = ["MANAGE_SALARY", "APPROVE_PAYROLL", "VIEW_FINANCIAL_REPORTS"];
function requirePayrollRead(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (RUN_READ_PERMISSIONS.some((code) => codes.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${RUN_READ_PERMISSIONS.join(", ")}`);
}

/**
 * Sending a PROCESSED run back for correction, or abandoning it, is open to
 * either side of the maker-checker pair: the preparer may withdraw it, and
 * the approver may reject it during review.
 */
const RUN_REVIEW_PERMISSIONS = ["MANAGE_SALARY", "APPROVE_PAYROLL"];
function requireRunReview(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (RUN_REVIEW_PERMISSIONS.some((code) => codes.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${RUN_REVIEW_PERMISSIONS.join(", ")}`);
}

// ---------------------------------------------------------------------------
// /payroll -- runs, processing, approval, payments
// ---------------------------------------------------------------------------

const router = Router();
router.use(authenticate);

router.get("/runs", requirePayrollRead, listPayrollRunsHandler);
router.get("/runs/:id", requirePayrollRead, getPayrollRunHandler);

router.post("/runs", requirePermission("MANAGE_SALARY"), createPayrollRunHandler);
// FRS 29.3's own `POST /payroll/generate` is this action, against a run
// already created above -- named as a status transition here so it goes
// through the same STATUS_TRANSITIONS guard every other lifecycle route does.
router.patch("/runs/:id/process", requirePermission("MANAGE_SALARY"), processPayrollRunHandler);

// Maker-checker: FINALIZE requires APPROVE_PAYROLL, and the service itself
// additionally refuses a preparer finalizing their own run.
router.patch("/runs/:id/finalize", requirePermission("APPROVE_PAYROLL"), finalizePayrollRunHandler);
router.patch("/runs/:id/reject", requireRunReview, rejectPayrollRunHandler);
router.patch("/runs/:id/cancel", requireRunReview, cancelPayrollRunHandler);

// Payslip payment recording -- Finance's act of actually processing the
// payout, same MANAGE_SALARY holder as generation (FRS 11.1's analogous step
// 7, "Finance processes payment").
router.patch("/runs/:id/payslips/:payslipId/mark-paid", requirePermission("MANAGE_SALARY"), markPayslipPaidHandler);
router.patch("/runs/:id/payslips/:payslipId/mark-failed", requirePermission("MANAGE_SALARY"), markPayslipFailedHandler);

// ---------------------------------------------------------------------------
// /employees/:id/payslips (FRS 29.3)
// Exported separately and mounted at "/employees" alongside the existing
// employees module's router -- same convention as apReportRoutes/
// arReportRoutes being mounted at "/reports" alongside their owning module.
// Salary structure itself (GET/PUT .../salary-structure) is now mounted from
// the Salaries module at the same "/employees" prefix -- see
// src/modules/salaries/salary.routes.js -- not duplicated here.
// ---------------------------------------------------------------------------

export const employeePayrollRoutes = Router();
employeePayrollRoutes.use(authenticate);

// FRS 29.3: viewing payslips follows the Section 8 hierarchy
// (self / subordinate-of-requester / VIEW_COMPANY_SALARY override) -- the
// exact same requireSalaryAccess gate every other salary endpoint in this
// codebase is meant to use, not a bespoke check.
employeePayrollRoutes.get(
  "/:id/payslips",
  requireSalaryAccess((req) => req.params.id),
  listEmployeePayslipsHandler
);

// ---------------------------------------------------------------------------
// /payslips/:id (FRS 29.3)
// ---------------------------------------------------------------------------

export const payslipRoutes = Router();
payslipRoutes.use(authenticate);
payslipRoutes.get(
  "/:id",
  requireSalaryAccess((req) => getPayslipEmployeeId(req.params.id)),
  getPayslipHandler
);

export default router;
