import { Router } from "express";
import {
  listVendorBillsHandler,
  getVendorBillHandler,
  listPaymentsHandler,
  createVendorBillHandler,
  updateVendorBillHandler,
  submitVendorBillHandler,
  verifyVendorBillHandler,
  sendForApprovalHandler,
  approveVendorBillHandler,
  rejectVendorBillHandler,
  reopenVendorBillHandler,
  cancelVendorBillHandler,
  recordPaymentHandler,
  payableReportHandler,
} from "./vendorBill.controller.js";
import { requireVendorRead } from "./vendor.routes.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

const router = Router();

router.use(authenticate);

/**
 * Rejection is open to both review roles: FRS 16.2 puts a verification step and
 * an approval step in front of payment, and either reviewer saying no is a
 * rejection. requirePermission takes one code and this is an OR across two, so
 * the gate is composed here, as requireInvoiceRead is in the invoices module.
 */
const REJECT_PERMISSIONS = ["VERIFY_VENDOR_BILL", "APPROVE_VENDOR_BILL"];

function requireBillReview(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  const codes = req.user.permissionCodes || [];
  if (REJECT_PERMISSIONS.some((code) => codes.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${REJECT_PERMISSIONS.join(", ")}`);
}

// --- AP report (FRS 22 "Vendor Payable") ------------------------------------
// Exported separately because Section 22 mounts reports under /reports, not
// /vendor-bills, while the logic behind this one is pure bill/payment
// aggregation and belongs with the bills it reads. Section 22 gates it on
// "Super Admin, Finance Admin" -- VIEW_FINANCIAL_REPORTS is that permission.
// Mirrors how the invoices module exports arReportRoutes.
export const apReportRoutes = Router();
apReportRoutes.use(authenticate);
apReportRoutes.get("/payable", requirePermission("VIEW_FINANCIAL_REPORTS"), payableReportHandler);

// --- Reads ------------------------------------------------------------------
// Same read gate as /vendors: anyone who can act on a bill, plus Finance's
// reporting override.
router.get("/", requireVendorRead, listVendorBillsHandler);
router.get("/:id", requireVendorRead, getVendorBillHandler);
router.get("/:id/payments", requireVendorRead, listPaymentsHandler);

// --- Writes -----------------------------------------------------------------
// Permission codes sit on the route, never inside the service, so SUPER_ADMIN
// keeps the Section 30 bypass built into requirePermission. The one rule that
// is NOT a permission -- maker-checker, "the approver must differ from the
// creator" -- lives in the service, because it compares the caller against the
// bill's own createdById.
//
// There is deliberately no DELETE anywhere in this file (Section 26 rule 6 /
// FR-18). A bill is retired by PATCH /:id/cancel with a reason, which keeps it
// in the audit trail and out of the payable figures.
//
// There is also no endpoint that sets status directly. Every transition has its
// own verb, because each carries a different rule and a different permission:
// PARTIALLY_PAID and PAID are derivable only from payment sums, so neither is
// reachable from a caller-supplied status.
router.post("/", requirePermission("MANAGE_VENDORS"), createVendorBillHandler);
router.patch("/:id", requirePermission("MANAGE_VENDORS"), updateVendorBillHandler);

// FRS 16.2 lifecycle: Created -> Verification -> Approval -> Payment.
router.patch("/:id/submit", requirePermission("MANAGE_VENDORS"), submitVendorBillHandler);
router.patch("/:id/verify", requirePermission("VERIFY_VENDOR_BILL"), verifyVendorBillHandler);
// Routing a verified bill into the approval queue is the verifier's act, and it
// is a separate state in the Section 16.3 chain ("Verified -> Pending
// Approval"), so it is a separate endpoint rather than a side effect of verify.
router.patch("/:id/send-for-approval", requirePermission("VERIFY_VENDOR_BILL"), sendForApprovalHandler);
router.patch("/:id/approve", requirePermission("APPROVE_VENDOR_BILL"), approveVendorBillHandler);
router.patch("/:id/reject", requireBillReview, rejectVendorBillHandler);
// Rejected -> Draft. MANAGE_VENDORS, because correcting the bill is the data
// owner's job, not the reviewer's.
router.patch("/:id/reopen", requirePermission("MANAGE_VENDORS"), reopenVendorBillHandler);
router.patch("/:id/cancel", requirePermission("APPROVE_VENDOR_BILL"), cancelVendorBillHandler);

// FRS 29.7 POST /vendor-bills/:id/payments. Paying money out is an act distinct
// from approving the bill, hence its own permission.
router.post("/:id/payments", requirePermission("RECORD_VENDOR_PAYMENT"), recordPaymentHandler);

export default router;
