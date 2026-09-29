// Razorpay webhook -- HTTP layer (Payment Gateway Stage 7).
//
// Thin, same convention as every other controller: parse -> call the
// service -> wrap the response. The one difference from every other
// controller in this codebase: `req.body` here is a raw Buffer, not parsed
// JSON -- see the route-scoped express.raw() in app.js -- because Razorpay's
// webhook signature must be verified against the exact bytes Razorpay signed
// (Stage 7 Section 2). This controller never parses it itself; that's
// payment.webhook.service.js's job, only after the signature checks out.

import * as webhookService from "./payment.webhook.service.js";
import { ok } from "../../utils/apiResponse.js";

const SIGNATURE_HEADER = "x-razorpay-signature";

export async function razorpayWebhookHandler(req, res, next) {
  try {
    const result = await webhookService.processRazorpayWebhook({
      rawBody: req.body,
      signature: req.headers[SIGNATURE_HEADER],
      headers: req.headers,
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}
