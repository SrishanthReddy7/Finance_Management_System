// RazorpayX payout webhook -- HTTP layer (Payout Subsystem Step 3C).
//
// Thin, same convention as every other controller: parse -> call the
// service -> wrap the response. The one difference from every other
// controller in this codebase (mirroring payment.webhook.controller.js's
// own, identical note): `req.body` here is a raw Buffer, not parsed JSON --
// see the route-scoped raw-body parser in app.js -- because RazorpayX's
// webhook signature must be verified against the exact bytes RazorpayX
// signed. This controller never parses it itself; that's
// payout.webhook.service.js's job, only after the signature checks out.

import * as webhookService from "./payout.webhook.service.js";
import { ok } from "../../utils/apiResponse.js";

const SIGNATURE_HEADER = "x-razorpay-signature";

export async function razorpayXPayoutWebhookHandler(req, res, next) {
  try {
    const result = await webhookService.processRazorpayXWebhook({
      rawBody: req.body,
      signature: req.headers[SIGNATURE_HEADER],
      headers: req.headers,
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}
