import { Router } from "express";
import {
  createReimbursementPayoutHandler,
  createSalaryPayoutHandler,
  createVendorPayoutHandler,
  approvePayoutHandler,
  rejectPayoutHandler,
  cancelPayoutHandler,
  syncPayoutHandler,
  retryPayoutHandler,
  getPayoutHandler,
  listPayoutsHandler,
  setPayoutAccountHandler,
  getPayoutAccountHandler,
} from "./payout.controller.js";
import { razorpayXPayoutWebhookHandler } from "./payout.webhook.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

// Read gate composed the same way payroll's requirePayrollRead/vendor bills'
// requireBillReview are: an OR across the maker and checker permissions, plus
// VIEW_PAYOUT for pure read access, plus the Section 30 SUPER_ADMIN bypass
// requirePermission itself would give a single code.
const READ_PERMISSIONS = ["INITIATE_PAYOUT", "APPROVE_PAYOUT", "VIEW_PAYOUT"];
function requirePayoutRead(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (READ_PERMISSIONS.some((code) => codes.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${READ_PERMISSIONS.join(", ")}`);
}

// Hardening pass (Step 3 audit Section 3.4): /sync can MUTATE a payout --
// all the way to PROCESSED, which marks a source paid -- so it must NOT be
// reachable with VIEW_PAYOUT alone (a permission whose own seed.js
// description is "View payouts"). Deliberately narrower than
// requirePayoutRead: only the two operational (maker/checker) permissions,
// matching the maker-or-checker composition this route was always intended
// to have (see Handsoff.md's own description of this endpoint).
const OPERATE_PERMISSIONS = ["INITIATE_PAYOUT", "APPROVE_PAYOUT"];
function requirePayoutOperate(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (OPERATE_PERMISSIONS.some((code) => codes.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${OPERATE_PERMISSIONS.join(", ")}`);
}

const router = Router();
router.use(authenticate);

// --- Reads -------------------------------------------------------------
router.get("/", requirePayoutRead, listPayoutsHandler);
router.get("/:id", requirePayoutRead, getPayoutHandler);

// --- Creation (maker) ----------------------------------------------------
// POST, not PATCH -- these create a new Payout resource, same convention
// POST /vendor-bills/:id/payments uses for creating a VendorPayment.
router.post("/reimbursements/:reimbursementId", requirePermission("INITIATE_PAYOUT"), createReimbursementPayoutHandler);
router.post("/payslips/:payslipId", requirePermission("INITIATE_PAYOUT"), createSalaryPayoutHandler);
router.post("/vendor-bills/:vendorBillId", requirePermission("INITIATE_PAYOUT"), createVendorPayoutHandler);

// --- Maker-checker + lifecycle transitions (checker) --------------------
// PATCH, matching vendorBill.routes.js/payroll.routes.js's convention for
// every state-transition endpoint in this codebase.
router.patch("/:id/approve", requirePermission("APPROVE_PAYOUT"), approvePayoutHandler);
router.patch("/:id/reject", requirePermission("APPROVE_PAYOUT"), rejectPayoutHandler);
router.patch("/:id/cancel", requirePermission("APPROVE_PAYOUT"), cancelPayoutHandler);
router.patch("/:id/retry", requirePermission("APPROVE_PAYOUT"), retryPayoutHandler);

// Development/reconciliation FALLBACK (payout.service.js's own doc comment)
// -- the RazorpayX webhook below (Step 3C) is the intended PRIMARY path;
// this route exists for manual reconciliation and MOCK-provider testing.
// VIEW_PAYOUT is deliberately NOT sufficient here -- see requirePayoutOperate.
router.patch("/:id/sync", requirePayoutOperate, syncPayoutHandler);

export default router;

// ---------------------------------------------------------------------------
// /employees/:id/payout-account (minimal, per Step 2 scope -- no full
// verification workflow/UI). Exported separately and mounted at "/employees"
// alongside the employees module's router, same convention
// employeePayrollRoutes/salaryRoutes already use.
// ---------------------------------------------------------------------------

export const employeePayoutAccountRoutes = Router();
employeePayoutAccountRoutes.use(authenticate);
employeePayoutAccountRoutes.post("/:id/payout-account", requirePermission("MANAGE_PAYOUT_ACCOUNTS"), setPayoutAccountHandler);
employeePayoutAccountRoutes.get("/:id/payout-account", requirePermission("MANAGE_PAYOUT_ACCOUNTS"), getPayoutAccountHandler);

// ---------------------------------------------------------------------------
// RazorpayX payout webhook (Payout Subsystem Step 3C) -- deliberately a
// SEPARATE router with NO authenticate()/requirePermission(), same reasoning
// payment.routes.js's own paymentWebhookRoutes uses: this is a
// server-to-server notification path, RazorpayX never carries this
// application's JWT and never will. RazorpayX's own webhook signature
// (verified in payout.webhook.service.js against the raw body captured by a
// route-scoped raw-body parser in app.js) is this router's entire trust
// boundary.
// ---------------------------------------------------------------------------

export const payoutWebhookRoutes = Router();
payoutWebhookRoutes.post("/razorpayx", razorpayXPayoutWebhookHandler);
