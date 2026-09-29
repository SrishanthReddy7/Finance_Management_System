// Razorpay-specific constants and error type (Payment Gateway Stage 4).
//
// Kept here, not duplicated in client.js/service.js, so both can import from
// one place. Deliberately small -- this is provider plumbing, not a home for
// business rules (those belong to the payments module in a later stage).

// Matches the Prisma `PaymentGatewayProvider` enum's RAZORPAY value. Defined
// independently here (not imported from @prisma/client) so this integration
// layer has no dependency on the ORM -- a later-stage caller is responsible
// for reconciling the two when it writes a PaymentTransaction row.
export const RAZORPAY_PROVIDER = "RAZORPAY";

// FRS/Stage 2 decision: MVP is INR-only (Stage 2 correction, Section J -- no
// FX/currency conversion). Razorpay's API takes amounts in the smallest unit
// of the currency (paise for INR, i.e. rupees x 100); this multiplier is only
// valid for INR. A future non-INR currency needs its own multiplier and its
// own decision, not a guess added here.
export const INR_SMALLEST_UNIT_MULTIPLIER = 100;

export const RAZORPAY_MODES = ["test", "live"];
export const DEFAULT_RAZORPAY_MODE = "test";

// Error codes a later-stage caller (the payments module) can switch on to
// decide how to respond, without needing to know Razorpay's own error shapes.
export const RAZORPAY_ERROR_CODES = {
  CONFIG_MISSING: "RAZORPAY_CONFIG_MISSING",
  INVALID_INPUT: "RAZORPAY_INVALID_INPUT",
  UNSUPPORTED_CURRENCY: "RAZORPAY_UNSUPPORTED_CURRENCY",
  API_ERROR: "RAZORPAY_API_ERROR",
  INVALID_PAYMENT_SIGNATURE: "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  INVALID_WEBHOOK_SIGNATURE: "RAZORPAY_INVALID_WEBHOOK_SIGNATURE",
  // Payment Gateway Stage 10 (Stage 8 design): the refund SDK call's error
  // must be split into two distinct cases, not lumped into API_ERROR --
  // whether Razorpay definitely rejected the request (safe to mark FAILED)
  // vs. whether the outcome is genuinely unknown (must stay REQUESTED, never
  // retried blindly). See razorpay.service.js's createRefund for how each is
  // detected.
  REFUND_API_ERROR: "RAZORPAY_REFUND_API_ERROR",
  REFUND_UNCERTAIN: "RAZORPAY_REFUND_UNCERTAIN",
};

/**
 * Provider-layer error, deliberately NOT the application's `AppError`
 * (src/middleware/error.middleware.js) -- this integration has no dependency
 * on Express or HTTP status codes, so it can be used by any future caller.
 * Whoever calls into razorpay.service.js in a later stage is responsible for
 * mapping `code` onto an HTTP status (e.g. CONFIG_MISSING -> 500,
 * INVALID_PAYMENT_SIGNATURE -> 400/409) -- that mapping is business/API
 * layer, not provider layer.
 */
export class RazorpayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RazorpayError";
    this.code = code;
  }
}
