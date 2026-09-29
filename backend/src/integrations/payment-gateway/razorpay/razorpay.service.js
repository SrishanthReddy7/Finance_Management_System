// Razorpay provider-level wrappers (Payment Gateway Stage 4).
//
// Scope, deliberately narrow: isolate the three Razorpay-specific operations
// a later stage will need (order creation, payment-signature verification,
// webhook-signature verification) behind a clean, provider-agnostic-looking
// interface. This file does NOT:
//   - know what an Invoice or a ClientPayment is
//   - calculate invoice outstanding amounts (the caller supplies `amount`)
//   - write PaymentTransaction/PaymentGatewayEvent rows
//   - update invoice balances/statuses
//   - check permissions/RBAC
//   - process webhook events (only verifies the delivery's signature)
// All of that is the payments module's job, in a later stage.

import crypto from "crypto";
import { env } from "../../../config/env.js";
import { getRazorpayClient } from "./razorpay.client.js";
import { INR_SMALLEST_UNIT_MULTIPLIER, RazorpayError, RAZORPAY_ERROR_CODES } from "./razorpay.constants.js";

/**
 * Creates a Razorpay order for an amount the CALLER has already decided.
 *
 * This function trusts `amount`/`currency` completely -- it does no invoice
 * lookup and applies no business rule about what the amount should be. Per
 * the Stage 2 design (Section J), the caller is responsible for computing
 * the invoice's current outstanding amount server-side before calling this;
 * a frontend-supplied amount must never reach here unchecked, but enforcing
 * that is the payments module's job, not this one's.
 *
 * @param {object} input
 * @param {number} input.amount - Amount in the currency's MAJOR unit (e.g.
 *   rupees, not paise). Converted to Razorpay's expected smallest-unit
 *   integer here.
 * @param {string} input.currency - ISO currency code. MVP only knows how to
 *   convert INR (Stage 2 decision: no FX) -- any other value is rejected.
 * @param {string} [input.receipt] - An opaque receipt/reference string
 *   Razorpay echoes back; the caller decides what it means.
 * @param {object} [input.notes] - Arbitrary key/value metadata Razorpay
 *   stores alongside the order and echoes back; the caller decides what, if
 *   anything, belongs here.
 * @returns {Promise<{gatewayOrderId: string, amount: number, amountInSmallestUnit: number, currency: string, status: string, receipt: string|null}>}
 */
export async function createOrder({ amount, currency, receipt, notes } = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_INPUT, "createOrder requires a positive numeric amount.");
  }
  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_INPUT, "createOrder requires a currency code.");
  }

  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency !== "INR") {
    // Stage 2 correction, Section J: MVP has no FX/conversion, so this
    // wrapper only knows the INR->paise conversion. Not an invoice rule --
    // just this integration's current capability.
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.UNSUPPORTED_CURRENCY,
      `Razorpay order creation only supports INR in this stage; received "${normalizedCurrency}".`
    );
  }

  const amountInSmallestUnit = Math.round(amount * INR_SMALLEST_UNIT_MULTIPLIER);

  const client = getRazorpayClient();
  let order;
  try {
    order = await client.orders.create({
      amount: amountInSmallestUnit,
      currency: normalizedCurrency,
      receipt: receipt ?? undefined,
      notes: notes ?? undefined,
      // Auto-capture on authorization -- the alternative (manual capture) is
      // a separate confirm-then-capture flow this stage does not implement.
      payment_capture: 1,
    });
  } catch (err) {
    // Never forward the raw SDK error: it can carry request/response detail
    // this layer shouldn't leak into logs or API responses (Section 6).
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.API_ERROR,
      err?.error?.description || err?.message || "Razorpay order creation failed."
    );
  }

  return {
    gatewayOrderId: order.id,
    amount,
    amountInSmallestUnit: order.amount,
    currency: order.currency,
    status: order.status,
    receipt: order.receipt ?? null,
  };
}

/**
 * Submits a refund request to Razorpay against an already-VERIFIED payment
 * (Payment Gateway Stage 10, Stage 8 design). Like createOrder, this function
 * trusts `gatewayPaymentId`/`amount`/`currency` completely -- the caller
 * (the payments module) is responsible for having already determined the
 * refundable balance and located the correct gateway payment id; this layer
 * does no ClientPayment/PaymentRefund lookup and writes nothing to the
 * database.
 *
 * Error classification is the important part of this function (Stage 8/10's
 * "never convert an uncertain timeout into a deterministic failure" rule):
 * the underlying SDK's own `API` class (node_modules/razorpay/dist/api.js)
 * throws a normalized `{ statusCode, error }` shape ONLY once axios has
 * actually received an HTTP response from Razorpay -- i.e. Razorpay
 * definitely received the request and synchronously rejected it (bad
 * payment id, already fully refunded, invalid amount, etc). Any other
 * thrown value (no `statusCode` -- a raw axios network/timeout error with no
 * `err.response` at all, e.g. ECONNABORTED/ETIMEDOUT) means this process
 * cannot tell whether Razorpay ever received, let alone created, the
 * refund -- that must be surfaced distinctly so the caller keeps the refund
 * in a non-terminal state rather than guessing.
 *
 * @param {object} input
 * @param {string} input.gatewayPaymentId - The Razorpay payment being refunded.
 * @param {number} input.amount - Amount in the currency's MAJOR unit (rupees),
 *   same convention as createOrder.
 * @param {string} input.currency - INR only, same MVP boundary as createOrder.
 * @param {object} [input.notes] - Arbitrary key/value metadata.
 * @returns {Promise<{gatewayRefundId: string, amount: number, amountInSmallestUnit: number, currency: string, gatewayStatus: string}>}
 */
export async function createRefund({ gatewayPaymentId, amount, currency, notes } = {}) {
  if (typeof gatewayPaymentId !== "string" || gatewayPaymentId.trim().length === 0) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_INPUT, "createRefund requires a gatewayPaymentId.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_INPUT, "createRefund requires a positive numeric amount.");
  }
  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_INPUT, "createRefund requires a currency code.");
  }

  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency !== "INR") {
    // Same MVP boundary as createOrder (Stage 2 correction, Section J) --
    // this wrapper only knows the INR<->paise conversion.
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.UNSUPPORTED_CURRENCY,
      `Razorpay refunds only support INR in this stage; received "${normalizedCurrency}".`
    );
  }

  const amountInSmallestUnit = Math.round(amount * INR_SMALLEST_UNIT_MULTIPLIER);

  const client = getRazorpayClient();
  let refund;
  try {
    refund = await client.payments.refund(gatewayPaymentId, {
      amount: amountInSmallestUnit,
      notes: notes ?? undefined,
    });
  } catch (err) {
    if (err && typeof err.statusCode === "number") {
      // Razorpay actually responded with a rejection -- the request is
      // definitively known to have failed before any refund was created.
      throw new RazorpayError(
        RAZORPAY_ERROR_CODES.REFUND_API_ERROR,
        err?.error?.description || "Razorpay rejected the refund request."
      );
    }
    // No HTTP response reached this process at all (network failure,
    // timeout, connection reset, ...) -- Razorpay may or may not have
    // received/created the refund. This is NOT a deterministic failure.
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.REFUND_UNCERTAIN,
      err?.message || "Razorpay refund request outcome could not be confirmed (no response received)."
    );
  }

  return {
    gatewayRefundId: refund.id,
    amount,
    amountInSmallestUnit: refund.amount,
    currency: refund.currency,
    // Razorpay's own refund.status ('pending' | 'processed' | 'failed') --
    // informational only. This codebase's own PaymentRefundStatus is driven
    // by whether the SUBMISSION succeeded (-> PROCESSING) or not, never by
    // this raw gateway status; final confirmation is the webhook's job
    // (a later stage), not this synchronous response.
    gatewayStatus: refund.status,
  };
}

/**
 * Verifies the signature Razorpay's checkout returns after a payment
 * (`razorpay_order_id` + `razorpay_payment_id` + `razorpay_signature`),
 * per Razorpay's documented HMAC-SHA256 scheme using the API key secret.
 *
 * Resolves to `true` on success; throws a `RazorpayError` for every failure
 * case (missing config, bad input, or a genuine mismatch) so a later caller
 * has one consistent try/catch + `error.code` pattern across every method in
 * this file, rather than mixing thrown errors with a plain boolean return.
 *
 * @param {object} input
 * @param {string} input.gatewayOrderId
 * @param {string} input.gatewayPaymentId
 * @param {string} input.signature
 * @returns {true}
 */
export function verifyPaymentSignature({ gatewayOrderId, gatewayPaymentId, signature } = {}) {
  if (!gatewayOrderId || !gatewayPaymentId || !signature) {
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.INVALID_INPUT,
      "verifyPaymentSignature requires gatewayOrderId, gatewayPaymentId, and signature."
    );
  }

  const { keySecret } = env.razorpay;
  if (!keySecret) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.CONFIG_MISSING, "RAZORPAY_KEY_SECRET is not configured.");
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest("hex");

  if (!safeHexEqual(expected, signature)) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_PAYMENT_SIGNATURE, "Payment signature verification failed.");
  }

  return true;
}

/**
 * Verifies an inbound Razorpay webhook delivery's signature, per Razorpay's
 * documented HMAC-SHA256 scheme using the webhook secret (distinct from the
 * API key secret).
 *
 * `rawBody` MUST be the exact bytes/string Razorpay signed -- a re-serialized
 * `JSON.stringify(parsedBody)` is not guaranteed to match byte-for-byte
 * (key order, whitespace) and would make correct deliveries fail
 * verification. Capturing the true raw body is the caller's responsibility
 * (e.g. an Express raw-body parser on the webhook route) in a later stage;
 * this function only ever consumes what it is given.
 *
 * Event processing (looking up the PaymentTransaction, writing a
 * PaymentGatewayEvent row, etc.) is explicitly NOT this function's job --
 * see the file-level comment.
 *
 * @param {object} input
 * @param {string|Buffer} input.rawBody
 * @param {string} input.signature
 * @returns {true}
 */
export function verifyWebhookSignature({ rawBody, signature } = {}) {
  if (rawBody == null || rawBody === "" || !signature) {
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.INVALID_INPUT,
      "verifyWebhookSignature requires rawBody and signature."
    );
  }

  const { webhookSecret } = env.razorpay;
  if (!webhookSecret) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.CONFIG_MISSING, "RAZORPAY_WEBHOOK_SECRET is not configured.");
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  if (!safeHexEqual(expected, signature)) {
    throw new RazorpayError(RAZORPAY_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE, "Webhook signature verification failed.");
  }

  return true;
}

/**
 * Constant-time hex-string comparison. `crypto.timingSafeEqual` throws on a
 * length mismatch rather than returning false, which would itself leak
 * timing information about the expected length -- guarded here so a
 * malformed/wrong-length signature just fails cleanly.
 */
function safeHexEqual(expectedHex, providedHex) {
  if (typeof providedHex !== "string") return false;
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(providedHex, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
