// RazorpayX-specific constants (Payout Subsystem Step 3B-1). Mirrors
// razorpay.constants.js's role for the inbound gateway -- small, shared
// plumbing for the razorpayx.client.js/razorpayx.provider.js pair, not a
// home for business rules.

// Matches the Prisma `PayoutProvider` enum's RAZORPAYX value. Defined
// independently here (not imported from @prisma/client), same reasoning as
// razorpay.constants.js's RAZORPAY_PROVIDER -- this integration layer has no
// dependency on the ORM.
export const RAZORPAYX_PROVIDER = "RAZORPAYX";

export const RAZORPAYX_API_BASE_URL = "https://api.razorpay.com/v1";

// Denylist-based recursive sanitizer, applied INSIDE this provider before
// `raw` is ever returned to any caller -- payout-provider.interface.js's own
// header comment is explicit that a provider must not rely on
// PayoutService's own sanitizeProviderResponse (payout.service.js) as its
// only safeguard. RazorpayX's Fund Account create response echoes the bank
// account number and IFSC straight back, and the VPA response echoes the
// full UPI address back (confirmed against the current official docs, Step
// 3A research) -- exactly the plaintext banking/PII detail this step's
// security requirements forbid ever persisting or logging. email/contact
// (phone) are stripped too, out of the same caution, even though they are
// not "banking" secrets -- this application already has both on
// Employee/User, so a provider response never needs to carry them forward.
// `debit_account_number` (Step 3B-2: the Payout create/fetch response
// echoes back the COMPANY's own operating account number, a different key
// name than `account_number`) is stripped too -- not the beneficiary's
// data, but minimizing what a real account number this system already
// knows via RAZORPAYX_ACCOUNT_NUMBER also sits in a plain, unencrypted
// providerResponse column. `authorization`/`key_secret`/`password` are
// stripped purely as defense-in-depth (Step 3B-2 test coverage) -- no real
// RazorpayX response body would ever contain these (razorpayXRequest only
// ever parses the HTTP response BODY, never its own request headers), but
// nothing should be able to survive into a persisted response if it somehow
// did.
const SENSITIVE_RESPONSE_KEYS = new Set([
  "account_number",
  "debit_account_number",
  "ifsc",
  "vpa",
  "email",
  "contact",
  "authorization",
  "key_secret",
  "password",
]);

export function sanitizeRazorpayXResponse(raw) {
  if (raw == null || typeof raw !== "object") return raw;
  if (Array.isArray(raw)) return raw.map(sanitizeRazorpayXResponse);
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_RESPONSE_KEYS.has(key)) continue;
    clean[key] = value && typeof value === "object" ? sanitizeRazorpayXResponse(value) : value;
  }
  return clean;
}

// --- Payout Subsystem Step 3B-2 -------------------------------------------

// Centralized internal-purpose -> RazorpayX-purpose mapping (Step 3A
// research: RazorpayX's own `purpose` enum is `refund`/`cashback`/`payout`/
// `salary`/`utility bill`/`vendor bill` -- there is no "reimbursement"
// value). Kept here, not scattered as string literals through the provider,
// so this is the ONE place to look up or extend the mapping. An internal
// purpose with no entry here must fail deterministically, never guess or
// fall through to a default.
export const RAZORPAYX_PURPOSE_MAP = {
  REIMBURSEMENT: "payout", // no closer match in RazorpayX's enum than the generic bucket
  SALARY: "salary",
  VENDOR_PAYMENT: "vendor bill",
};

// RazorpayX's own documented constraints (Step 3A research), validated
// defensively by the provider even though PayoutService's own
// `Payout.idempotencyKey` (a `crypto.randomUUID()`, 36 chars) already fits.
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_ -]{4,36}$/;
export const REFERENCE_ID_MAX_LENGTH = 40;
export const NARRATION_MAX_LENGTH = 30;
export const NARRATION_DISALLOWED_CHARS = /[^a-zA-Z0-9 ]/g;
export const MIN_PAYOUT_PAISE = 100; // RazorpayX's documented minimum, ₹1
