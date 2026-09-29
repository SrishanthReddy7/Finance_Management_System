import { Router } from "express";
import {
  listInvoicesHandler,
  getInvoiceHandler,
  listPaymentsHandler,
  createInvoiceHandler,
  updateInvoiceHandler,
  submitInvoiceHandler,
  approveInvoiceHandler,
  sendInvoiceHandler,
  cancelInvoiceHandler,
  recordPaymentHandler,
  syncOverdueHandler,
  guardDocumentUpload,
  addDocumentHandler,
  downloadDocumentHandler,
  outstandingReportHandler,
  agingReportHandler,
  clientPaymentReportHandler,
} from "./invoice.controller.js";
import { canSeeInvoices, INVOICE_READ_PERMISSIONS } from "./invoice.service.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { invoiceUpload, singleFileAnyField } from "../../middleware/upload.middleware.js";
import { fail } from "../../utils/apiResponse.js";

const router = Router();

router.use(authenticate);

/**
 * Section 29.6 names a permission for every invoice WRITE but never states a
 * read gate. Section 31 does: the Invoices and Invoice Detail pages are
 * "Finance/Admin", so reads are open to anyone holding a permission that lets
 * them act on invoices, plus Finance's VIEW_FINANCIAL_REPORTS override.
 *
 * requirePermission takes a single code, and this is an OR across four, so the
 * gate is composed here rather than in a handler -- the same place the projects
 * module puts its composite financial gate.
 */
function requireInvoiceRead(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (canSeeInvoices(req.user)) return next();
  return fail(res, 403, `Missing required permission: one of ${INVOICE_READ_PERMISSIONS.join(", ")}`);
}

// --- AR reports (FRS 15.3, 29.6 GET /reports/ar/*) --------------------------
// Exported separately because Section 29.6 mounts these under /reports, not
// /invoices, while the logic behind them is pure invoice/payment aggregation
// and belongs with the invoices it reads. Section 22 gates them on
// "Super Admin, Finance Admin" -- VIEW_FINANCIAL_REPORTS is that permission.
export const arReportRoutes = Router();
arReportRoutes.use(authenticate);
arReportRoutes.get("/outstanding", requirePermission("VIEW_FINANCIAL_REPORTS"), outstandingReportHandler);
arReportRoutes.get("/aging", requirePermission("VIEW_FINANCIAL_REPORTS"), agingReportHandler);
arReportRoutes.get("/client-payments", requirePermission("VIEW_FINANCIAL_REPORTS"), clientPaymentReportHandler);

// The "scheduled job" half of Section 14.2's Overdue rule, as an endpoint a
// real scheduler can call once one exists. See syncOverdueInvoices for why it
// is not run implicitly on reads. Declared before the "/:id" routes so the
// literal path is never swallowed by the parameter (same reason
// /expenses/categories is declared first).
router.post("/sync-overdue", requirePermission("CREATE_INVOICE"), syncOverdueHandler);

// --- Reads ------------------------------------------------------------------
router.get("/", requireInvoiceRead, listInvoicesHandler);
router.get("/:id", requireInvoiceRead, getInvoiceHandler);
router.get("/:id/payments", requireInvoiceRead, listPaymentsHandler);
router.get("/:id/documents/:documentId", requireInvoiceRead, downloadDocumentHandler);

// --- Writes -----------------------------------------------------------------
// Permission codes sit on the route, never inside the service, so SUPER_ADMIN
// keeps the Section 30 bypass built into requirePermission. The one rule that
// is NOT a permission -- maker-checker, "the approver must differ from the
// creator" (Section 26 rule 5) -- lives in the service, because it compares
// the caller against the invoice's own createdById.
//
// There is deliberately no DELETE anywhere in this file (Section 26 rule 6 /
// FR-18). An invoice is retired by PATCH /:id/cancel with a reason, which
// keeps it in the audit trail and out of the AR figures.
//
// There is also no endpoint that sets status directly. Every transition has
// its own verb, because each carries a different rule: Section 26 rule 9 makes
// PARTIALLY_PAID/PAID derivable only from payment sums, and OVERDUE only from
// the dated sweep -- so neither is reachable from a caller-supplied status.
router.post("/", requirePermission("CREATE_INVOICE"), createInvoiceHandler);
router.patch("/:id", requirePermission("CREATE_INVOICE"), updateInvoiceHandler);

// Section 14.2 lifecycle, one endpoint per documented transition.
router.patch("/:id/submit", requirePermission("CREATE_INVOICE"), submitInvoiceHandler);
router.patch("/:id/approve", requirePermission("APPROVE_INVOICE"), approveInvoiceHandler);
router.patch("/:id/send", requirePermission("CREATE_INVOICE"), sendInvoiceHandler);
router.patch("/:id/cancel", requirePermission("APPROVE_INVOICE"), cancelInvoiceHandler);

// Section 29.6 POST /invoices/:id/payments. Recording money in is a Finance
// act distinct from raising the invoice, hence its own permission.
router.post("/:id/payments", requirePermission("RECORD_CLIENT_PAYMENT"), recordPaymentHandler);

// FRS 14.1 "supporting documents". guardDocumentUpload runs *before* multer so
// an unauthorized or impossible upload never touches the disk (Section 32).
router.post(
  "/:id/documents",
  requirePermission("CREATE_INVOICE"),
  guardDocumentUpload,
  singleFileAnyField(invoiceUpload),
  addDocumentHandler
);

export default router;
