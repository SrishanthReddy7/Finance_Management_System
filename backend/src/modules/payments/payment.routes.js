// Payments module -- route definitions (Payment Gateway Stages 5-7).

import { Router } from "express";
import {
  initiatePaymentHandler,
  verifyPaymentHandler,
  initiateRefundHandler,
  approveRefundHandler,
} from "./payment.controller.js";
import { razorpayWebhookHandler } from "./payment.webhook.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();
router.use(authenticate);

// Stage 5: online payment initiation is the digital equivalent of
// POST /invoices/:id/payments (recording money coming in against an
// invoice) -- invoice.routes.js already gates that endpoint on
// RECORD_CLIENT_PAYMENT (Finance Admin; Super Admin bypasses per Section 30).
// Reused rather than inventing a new permission: initiating an online
// payment doesn't grant any capability a RECORD_CLIENT_PAYMENT holder
// doesn't already have, and the FRS names no separate one for it.
router.post("/invoices/:invoiceId/initiate", requirePermission("RECORD_CLIENT_PAYMENT"), initiatePaymentHandler);

// Stage 6: verification is the point where the system records that money
// was actually received -- the same underlying capability/permission as the
// initiation route above and the manual /invoices/:id/payments endpoint.
// Authenticated only; no public/unauthenticated verification route exists
// (Stage 6 Section 1).
router.post("/verify", requirePermission("RECORD_CLIENT_PAYMENT"), verifyPaymentHandler);

// Stage 10 (corrected): refund initiation ONLY -- creates a REQUESTED
// PaymentRefund, no Razorpay call. Gated on INITIATE_REFUND (Stage 8 design,
// approved) -- deliberately NOT reused from RECORD_CLIENT_PAYMENT, since
// authorizing money back out is a different-risk operation than recording
// money in.
router.post(
  "/client-payments/:clientPaymentId/refunds",
  requirePermission("INITIATE_REFUND"),
  initiateRefundHandler
);

// Stage 10 correction: refund approval/submission -- the "checker" step that
// actually calls Razorpay. Gated on a SEPARATE permission, APPROVE_REFUND,
// so the maker-checker split (Stage 8 decision 15: maker != checker) is
// enforced both by permission AND, inside the service, by comparing the
// authenticated caller against the refund's own requestedById.
router.post("/refunds/:refundId/approve", requirePermission("APPROVE_REFUND"), approveRefundHandler);

export default router;

// Stage 7: the Razorpay webhook -- deliberately a SEPARATE router with NO
// `authenticate()` and NO `requirePermission()`. This is a server-to-server
// notification path; Razorpay never carries this application's JWT, and
// never will. Razorpay's own webhook signature (verified in
// payment.webhook.service.js against the raw body captured by the
// route-scoped express.raw() in app.js) is the entire trust boundary for
// this router (Stage 7 Section 1/20).
export const paymentWebhookRoutes = Router();
paymentWebhookRoutes.post("/razorpay", razorpayWebhookHandler);
