// Payments module -- HTTP layer (Payment Gateway Stages 5-6).
//
// Thin: parse -> call the service -> wrap in the standard envelope, matching
// every other module. No business rules and no permission checks here (the
// permission gate lives on the route, the business rules in payment.service.js).

import * as paymentService from "./payment.service.js";
import {
  initiatePaymentSchema,
  invoiceIdParamSchema,
  verifyPaymentSchema,
  clientPaymentIdParamSchema,
  initiateRefundSchema,
  refundIdParamSchema,
} from "./payment.validation.js";
import { ok, created } from "../../utils/apiResponse.js";

export async function initiatePaymentHandler(req, res, next) {
  try {
    const { invoiceId } = invoiceIdParamSchema.parse(req.params);
    const body = initiatePaymentSchema.parse(req.body ?? {});
    return created(res, await paymentService.initiatePayment(req.user, invoiceId, body));
  } catch (err) {
    next(err);
  }
}

// 200, not 201: this endpoint's second (and every subsequent) call for the
// same already-verified payment creates nothing -- it just reports the same
// settled state (Stage 6 Section 16), so "201 Created" would be misleading
// on a repeat.
export async function verifyPaymentHandler(req, res, next) {
  try {
    const body = verifyPaymentSchema.parse(req.body);
    return ok(res, await paymentService.verifyPayment(req.user, body));
  } catch (err) {
    next(err);
  }
}

// Stage 10 (corrected): refund initiation ONLY -- creates a REQUESTED
// PaymentRefund and stops. No Razorpay call happens here. 201 -- this always
// creates a new row.
export async function initiateRefundHandler(req, res, next) {
  try {
    const { clientPaymentId } = clientPaymentIdParamSchema.parse(req.params);
    const body = initiateRefundSchema.parse(req.body ?? {});
    return created(res, await paymentService.initiateRefund(req.user, clientPaymentId, body));
  } catch (err) {
    next(err);
  }
}

// Stage 10 correction: refund approval/submission -- the "checker" step.
// 200, not 201: this transitions an existing PaymentRefund, it never creates
// one.
export async function approveRefundHandler(req, res, next) {
  try {
    const { refundId } = refundIdParamSchema.parse(req.params);
    return ok(res, await paymentService.approveRefund(req.user, refundId));
  } catch (err) {
    next(err);
  }
}
