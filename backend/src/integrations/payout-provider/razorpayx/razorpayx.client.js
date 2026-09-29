// RazorpayX HTTP client (Payout Subsystem Step 3B-1).
//
// The ONLY file allowed to make an HTTP call to RazorpayX. Unlike the inbound
// Razorpay Payment Gateway (razorpay.client.js), which uses the official
// `razorpay` npm SDK, this module talks to RazorpayX directly over HTTP:
// the installed `razorpay` package (v2.9.8, confirmed by inspecting its
// exposed API surface directly in this sandbox) has no `contacts`/`payouts`
// resource at all, and an empty `fundAccount` resource -- it does not
// support RazorpayX's Contact/Fund Account/Payout endpoints. RazorpayX's own
// API family is plain HTTP Basic Auth over `https://api.razorpay.com/v1`
// (Step 3A research, verified against current official docs), so a small
// fetch-based client (Node's built-in global fetch -- this runtime is Node
// 24, confirmed -- no new npm dependency) is the correct, minimal choice
// here, not a workaround.
//
// CREDENTIAL REUSE DECISION (Step 3A research + explicit Step 3B-1
// instruction to decide): RazorpayX and the inbound Payment Gateway are
// confirmed to share the exact same key_id/key_secret pair (same
// Razorpay/RazorpayX account -- regenerating one regenerates both). Rather
// than duplicating that same secret value under a second env var name (a
// drift risk: two places that must always agree, with no mechanism forcing
// them to), this client reuses `env.razorpay.keyId/keySecret` directly. Only
// what is genuinely RazorpayX-specific -- the company's own RazorpayX
// operating current-account number, needed by the Payout API in a later
// step -- gets its own `env.razorpayx` config (see config/env.js).
//
// Nothing in this file is constructed/read at module load or server boot --
// same "fail loud only when actually used, never crash the whole app at
// boot" convention razorpay.client.js already established.

import { env } from "../../../config/env.js";
import { RAZORPAYX_API_BASE_URL } from "./razorpayx.constants.js";

/**
 * @returns {{keyId: string, keySecret: string}}
 * @throws {Error} if RazorpayX credentials are not configured.
 */
export function getRazorpayXCredentials() {
  const { keyId, keySecret } = env.razorpay;
  if (!keyId || !keySecret) {
    throw new Error("RazorpayX is not configured: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set.");
  }
  return { keyId, keySecret };
}

/**
 * The company's own RazorpayX current-account number -- required by the
 * Payout API's `account_number` field (a later step), NOT by Contact/Fund
 * Account provisioning. Exposed here now so a later step has one place to
 * read it from; nothing in Step 3B-1 calls this.
 */
export function getRazorpayXAccountNumber() {
  const accountNumber = env.razorpayx.accountNumber;
  if (!accountNumber) {
    throw new Error("RazorpayX is not configured: RAZORPAYX_ACCOUNT_NUMBER must be set.");
  }
  return accountNumber;
}

/**
 * Low-level authenticated request helper. Deliberately distinguishes two
 * failure shapes the caller (razorpayx.provider.js) needs to tell apart:
 *
 *   - `err.razorpayXNetworkError === true` -- fetch itself never got an HTTP
 *     response (DNS failure, connection reset, timeout). The outcome is
 *     genuinely unknown: RazorpayX may or may not have received/processed
 *     the request.
 *   - `err.razorpayXStatusCode` set -- a real HTTP response was received.
 *     The outcome IS known: RazorpayX definitely saw the request and gave
 *     this status back.
 *
 * This mirrors razorpay.service.js's own refund-error classification
 * precedent (its SDK-level `normalizeError` only classifies as deterministic
 * once an actual HTTP response exists) -- not invented fresh here, reused
 * from an already-proven pattern in this codebase.
 *
 * Never logs the request body (may contain plaintext bank details) or the
 * response body at this layer -- sanitization is the caller's job, applied
 * before anything is returned or persisted (razorpayx.constants.js's
 * sanitizeRazorpayXResponse).
 *
 * @param {"GET"|"POST"|"PATCH"} method
 * @param {string} path - e.g. "/contacts", must start with "/".
 * @param {object} [body]
 * @param {object} [extraHeaders] - e.g. `{"X-Payout-Idempotency": key}`
 *   (Payout Subsystem Step 3B-2) -- never used to smuggle anything into the
 *   request body; RazorpayX's idempotency mechanism is header-only (Step 3A
 *   research), so this is the one legitimate use so far.
 */
export async function razorpayXRequest(method, path, body, extraHeaders) {
  const { keyId, keySecret } = getRazorpayXCredentials();
  const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  let response;
  try {
    response = await fetch(`${RAZORPAYX_API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const err = new Error(`RazorpayX request to ${path} failed with no response: ${networkErr.message}`);
    err.razorpayXNetworkError = true;
    throw err;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = new Error(payload?.error?.description || `RazorpayX request to ${path} failed with status ${response.status}`);
    err.razorpayXStatusCode = response.status;
    err.razorpayXErrorBody = payload;
    throw err;
  }

  return payload;
}
