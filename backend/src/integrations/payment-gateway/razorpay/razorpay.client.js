// Razorpay SDK client (Payment Gateway Stage 4).
//
// The ONLY file in this codebase allowed to construct the Razorpay SDK
// instance. Nothing outside src/integrations/payment-gateway/razorpay/
// should import the "razorpay" package directly -- razorpay.service.js (and,
// in a later stage, the payments module) call getRazorpayClient() instead,
// so provider-SDK details stay isolated in this one place.

import Razorpay from "razorpay";
import { env } from "../../../config/env.js";
import { RazorpayError, RAZORPAY_ERROR_CODES } from "./razorpay.constants.js";

let cachedClient = null;

/**
 * Lazily constructs and caches the Razorpay SDK client from
 * RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.
 *
 * Deliberately NOT constructed at module load / server boot: RAZORPAY_KEY_ID
 * and RAZORPAY_KEY_SECRET are not in env.js's `required` list (no real
 * credentials exist yet), so a server that never touches online payments
 * must still start cleanly. This throws only when a caller actually needs a
 * working client -- predictable, not silent, and never falls back to fake
 * credentials.
 */
export function getRazorpayClient() {
  if (cachedClient) return cachedClient;

  const { keyId, keySecret } = env.razorpay;
  if (!keyId || !keySecret) {
    throw new RazorpayError(
      RAZORPAY_ERROR_CODES.CONFIG_MISSING,
      "Razorpay is not configured: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set."
    );
  }

  cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cachedClient;
}

/**
 * Test-only escape hatch: clears the cached client so a test can reconfigure
 * env vars and get a fresh instance. No production code path calls this.
 */
export function resetRazorpayClientCache() {
  cachedClient = null;
}
