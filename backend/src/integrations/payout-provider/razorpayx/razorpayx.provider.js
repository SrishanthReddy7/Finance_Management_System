// RazorpayXPayoutProvider (Payout Subsystem Step 3B-1: Contact/Fund Account
// provisioning; Step 3B-2: the REQUIRED createPayout/getPayoutStatus
// contract, i.e. actually submitting/checking a payout). NOW registered in
// payout-provider.interface.js's PROVIDERS map ("RAZORPAYX") -- Step 3B-1
// deliberately deferred that registration until both required methods
// existed; both do now.
//
// Still does NOT implement: webhooks, PayoutReversal, reconciliation, or
// automated fund-account validation (penny-drop) -- all explicitly Step 3C+.
//
// Follows payout-provider.interface.js's existing rules: no Prisma import,
// no knowledge of Reimbursement/Payslip/VendorBill/EmployeePayoutAccount, no
// business rules, no DB transaction held open across a network call.
//
// OPTIONAL CAPABILITY CONTRACT (new in this step -- see
// payout-provider.interface.js's header for the corresponding note):
//
//   async function ensureContact({ referenceId, name, email, phone, type })
//     -> { providerContactId: string, raw: object }
//
//   async function ensureFundAccount({ providerContactId, destination })
//     -> { providerFundAccountId: string, raw: object }
//
// Neither is part of the REQUIRED createPayout/getPayoutStatus contract --
// MockPayoutProvider does not (and should not) implement them. A caller must
// feature-detect (`typeof provider.ensureFundAccount === "function"`) rather
// than assume every provider supports provisioning.
//
// IDEMPOTENCY: RazorpayX itself deduplicates both Contact creation (by the
// combination of name/email/contact/type/reference_id) and Fund Account
// creation (by contact_id plus the matching bank_account/vpa fields) -- a
// repeat call with IDENTICAL fields returns the EXISTING resource rather
// than creating a duplicate (Step 3A research, confirmed against the
// current official docs). This is what makes ensureContact/ensureFundAccount
// safe to blindly retry after any failure, including "the provider call
// succeeded but our process crashed before persisting the result" -- no
// idempotency key or attempt-tracking is needed on this side, as long as the
// SAME reference_id and the SAME destination fields are passed every time,
// which is already guaranteed by the caller (reference_id is always the
// stable Employee.id; destination is derived fresh from the same stored,
// encrypted account record on every call).
//
// ERROR CLASSIFICATION: every failure is thrown as PayoutProviderError (the
// existing class from payout-provider.interface.js), with `isUncertain` set
// per classifyAndThrow below -- see its own comments for the exact mapping.

import crypto from "crypto";
import { env } from "../../../config/env.js";
import { PayoutProviderError } from "../payout-provider.interface.js";
import { razorpayXRequest, getRazorpayXAccountNumber } from "./razorpayx.client.js";
import {
  sanitizeRazorpayXResponse,
  RAZORPAYX_PURPOSE_MAP,
  IDEMPOTENCY_KEY_PATTERN,
  REFERENCE_ID_MAX_LENGTH,
  NARRATION_MAX_LENGTH,
  NARRATION_DISALLOWED_CHARS,
  MIN_PAYOUT_PAISE,
} from "./razorpayx.constants.js";

export const PROVIDER_NAME = "RAZORPAYX";

/**
 * Maps a razorpayXRequest failure onto PayoutProviderError's isUncertain
 * contract. Never assumes success; anything not positively classified as a
 * definite rejection is treated as uncertain (safe to retry regardless, per
 * the idempotency note above -- retrying provisioning can never create a
 * duplicate, unlike retrying a payout, so erring toward "uncertain" here has
 * no downside).
 */
function classifyAndThrow(err) {
  if (err instanceof PayoutProviderError) throw err;

  if (err?.razorpayXNetworkError) {
    // No HTTP response was ever received -- genuinely unknown whether
    // RazorpayX processed this.
    throw new PayoutProviderError(err.message, { isUncertain: true });
  }

  const status = err?.razorpayXStatusCode;

  if (status === 401 || status === 403) {
    // A real response was received: RazorpayX definitely rejected the
    // request for auth reasons. Deterministic, but surfaced as a
    // configuration problem, not a generic rejection.
    throw new PayoutProviderError(
      "RazorpayX authentication failed -- check the configured RazorpayX credentials.",
      { isUncertain: false }
    );
  }

  if (status === 429) {
    // Definitely NOT processed (RazorpayX rejected it before doing any
    // work), and safe to retry -- classified as uncertain purely to signal
    // "retry is safe/expected", not because the outcome is unknown.
    throw new PayoutProviderError("RazorpayX rate-limited the request.", { isUncertain: true });
  }

  if (typeof status === "number" && status >= 500) {
    // A response was received, but it's a server-side failure -- RazorpayX
    // itself may not know if it completed the work. Genuinely uncertain.
    throw new PayoutProviderError(err.message || `RazorpayX returned a server error (${status}).`, { isUncertain: true });
  }

  if (typeof status === "number" && status >= 400) {
    // A definite 4xx rejection (bad input, validation failure) -- RazorpayX
    // positively did not create anything.
    throw new PayoutProviderError(err.message || `RazorpayX rejected the request (${status}).`, { isUncertain: false });
  }

  // Unrecognized failure shape (e.g. a thrown error with no status at all,
  // or a malformed-but-200 response) -- never assume success.
  throw new PayoutProviderError(err?.message || "RazorpayX request failed with an unrecognized error.", { isUncertain: true });
}

/**
 * @param {object} input
 * @param {string} input.referenceId - Stable identity to dedupe on across
 *   retries -- callers must always pass the SAME value for the same
 *   employee/vendor (e.g. Employee.id), never a fresh one per attempt.
 * @param {string} input.name
 * @param {string} [input.email]
 * @param {string} [input.phone]
 * @param {string} [input.type] - e.g. "employee" | "vendor" | "customer" | "self"
 * @returns {Promise<{providerContactId: string, raw: object}>}
 */
export async function ensureContact({ referenceId, name, email, phone, type } = {}) {
  if (typeof referenceId !== "string" || referenceId.length === 0) {
    throw new Error("RazorpayXPayoutProvider.ensureContact requires referenceId.");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("RazorpayXPayoutProvider.ensureContact requires name.");
  }

  try {
    const raw = await razorpayXRequest("POST", "/contacts", {
      name: name.trim(),
      email: email || undefined,
      contact: phone || undefined,
      type: type || undefined,
      reference_id: referenceId,
    });
    if (!raw?.id) throw new Error("RazorpayX contact response did not include an id.");
    return { providerContactId: raw.id, raw: sanitizeRazorpayXResponse(raw) };
  } catch (err) {
    classifyAndThrow(err);
  }
}

/**
 * @param {object} input
 * @param {string} input.providerContactId
 * @param {object} input.destination - EXACTLY the shape
 *   payoutAccount.service.js's resolvePayoutDestination() already produces
 *   for its "no fund account yet" fallback branches: either
 *   `{ upiVpa, accountHolderName }` or
 *   `{ accountNumber, ifsc, accountHolderName }`. This function never logs,
 *   returns, or persists it beyond the one request body it is flattened
 *   into for this single call -- the caller is responsible for discarding
 *   its own reference immediately after this call returns (the same
 *   contract resolvePayoutDestination's own doc comment already states).
 * @returns {Promise<{providerFundAccountId: string, raw: object}>}
 */
export async function ensureFundAccount({ providerContactId, destination } = {}) {
  if (typeof providerContactId !== "string" || providerContactId.length === 0) {
    throw new Error("RazorpayXPayoutProvider.ensureFundAccount requires providerContactId.");
  }
  if (!destination || typeof destination !== "object") {
    throw new Error("RazorpayXPayoutProvider.ensureFundAccount requires destination.");
  }

  let body;
  if (destination.upiVpa) {
    body = {
      contact_id: providerContactId,
      account_type: "vpa",
      vpa: { address: destination.upiVpa },
    };
  } else if (destination.accountNumber && destination.ifsc) {
    body = {
      contact_id: providerContactId,
      account_type: "bank_account",
      bank_account: {
        name: destination.accountHolderName,
        ifsc: destination.ifsc,
        account_number: destination.accountNumber,
      },
    };
  } else {
    throw new Error("RazorpayXPayoutProvider.ensureFundAccount requires destination.upiVpa OR destination.accountNumber+ifsc.");
  }

  try {
    const raw = await razorpayXRequest("POST", "/fund_accounts", body);
    if (!raw?.id) throw new Error("RazorpayX fund account response did not include an id.");
    return { providerFundAccountId: raw.id, raw: sanitizeRazorpayXResponse(raw) };
  } catch (err) {
    classifyAndThrow(err);
  } finally {
    // Plaintext account number/IFSC/VPA lived only in this local `body` --
    // discard the reference as soon as the request is done, mirroring
    // resolvePayoutDestination's own "never store, log, or persist" contract.
    body = null;
  }
}

// ---------------------------------------------------------------------------
// createPayout / getPayoutStatus (Payout Subsystem Step 3B-2) -- the
// REQUIRED provider contract (payout-provider.interface.js). Everything
// above this point (ensureContact/ensureFundAccount) is the OPTIONAL
// provisioning capability Step 3B-1 built; this section is what actually
// moves money.
// ---------------------------------------------------------------------------

/**
 * Converts a MAJOR-unit rupee amount (this codebase's own convention --
 * Payout.amount is Decimal(14,2), and payout.service.js's submitPayoutToProvider
 * already passes `round2(num(claimed.amount))`, a plain JS number) to an
 * integer paise amount, the unit RazorpayX's Payout API requires.
 *
 * Deliberately stricter than razorpay.service.js's own `Math.round(amount *
 * INR_SMALLEST_UNIT_MULTIPLIER)` (which silently rounds away any noise): a
 * payout, unlike an inbound order amount the caller already validated
 * elsewhere, must never silently absorb an amount with more precision than
 * a rupee can represent. The `1e-6` tolerance exists ONLY to accommodate
 * ordinary floating-point representation noise (e.g. 1234.50 * 100 landing
 * a few ULPs off 123450) -- not to permit a genuinely third-decimal-place
 * amount through.
 */
function convertRupeesToPaise(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("RazorpayXPayoutProvider.createPayout requires a finite numeric amount.");
  }
  if (amount <= 0) {
    throw new Error("RazorpayXPayoutProvider.createPayout requires a positive amount; received a zero or negative value.");
  }
  const paise = amount * 100;
  const roundedPaise = Math.round(paise);
  if (Math.abs(paise - roundedPaise) > 1e-6) {
    throw new Error(`RazorpayXPayoutProvider.createPayout received an amount with more than two decimal places: ${amount}.`);
  }
  if (!Number.isSafeInteger(roundedPaise)) {
    throw new Error(`RazorpayXPayoutProvider.createPayout received an amount that cannot be safely converted to paise: ${amount}.`);
  }
  return roundedPaise;
}

/** Centralized purpose mapping lookup -- see RAZORPAYX_PURPOSE_MAP's own comment. */
function resolveRazorpayXPurpose(purpose) {
  const mapped = RAZORPAYX_PURPOSE_MAP[purpose];
  if (!mapped) {
    throw new Error(`RazorpayXPayoutProvider.createPayout has no RazorpayX purpose mapping for internal purpose "${purpose}".`);
  }
  return mapped;
}

// MVP mode-selection policy for bank-account payouts (Step 3B-2, explicit
// instruction to document a deterministic policy rather than guess): IMPS
// over NEFT/RTGS. Reasoning -- NEFT settles in batched windows (slower, and
// this application has no same-day-vs-next-day urgency distinction to
// justify the wait); RTGS traditionally has a large minimum transfer amount
// unsuited to typical reimbursement/salary/vendor payout sizes; IMPS settles
// near-instantly, 24x7, with no minimum, and RazorpayX supports it for
// standard bank transfers. This project's FRS gives no amount-tier policy
// for when RTGS should apply instead (the same reasoning already documented
// elsewhere in this codebase for not inventing an unspecified business rule,
// e.g. no invented tax-slab/PF-rate engine) -- if a real amount threshold
// requiring RTGS emerges later, this is the one place to add it.
const BANK_TRANSFER_MODE_MVP_POLICY = "IMPS";

/** Isolated here (never in PayoutService) per this step's explicit instruction. */
function resolveRazorpayXMode(destinationAccount) {
  if (destinationAccount?.fundAccountType === "vpa") return "UPI";
  if (destinationAccount?.fundAccountType === "bank_account") return BANK_TRANSFER_MODE_MVP_POLICY;
  throw new Error(
    "RazorpayXPayoutProvider.createPayout could not determine a payout mode: destinationAccount.fundAccountType is missing or unrecognized."
  );
}

/**
 * Deterministic, purpose-only narration -- never derived from anything
 * destination-related, so there is no path for it to ever carry account/IFSC/
 * VPA data. A short, stable suffix from `idempotencyKey` (safe characters
 * only, no separators) is appended purely so an operator reading a bank
 * statement can cross-reference a line back to this system -- it carries no
 * information beyond "this system created it", same as `reference_id`.
 */
function buildNarration(purpose, idempotencyKey) {
  const label = { REIMBURSEMENT: "Reimbursement", SALARY: "Salary", VENDOR_PAYMENT: "Vendor payment" }[purpose] || "Payout";
  const suffix = idempotencyKey.replace(NARRATION_DISALLOWED_CHARS, "").slice(-8).toUpperCase();
  return `${label} ${suffix}`.replace(NARRATION_DISALLOWED_CHARS, "").slice(0, NARRATION_MAX_LENGTH);
}

/**
 * @param {object} input
 * @param {string} input.idempotencyKey - Reused VERBATIM on every retry by
 *   the caller (payout.service.js's submitPayoutToProvider) -- this function
 *   never generates or modifies one. Sent as the `X-Payout-Idempotency`
 *   header (Step 3A research: RazorpayX's idempotency mechanism is
 *   header-only, never a body field) AND reused as `reference_id` (see
 *   below) -- both are DERIVED from the same caller-supplied value, never
 *   invented here.
 * @param {number} input.amount - Major unit (rupees), this codebase's own
 *   convention.
 * @param {string} input.currency - Must be "INR".
 * @param {string} input.purpose - A `PayoutPurpose` enum value.
 * @param {{providerFundAccountId: string, fundAccountType: "bank_account"|"vpa"}} input.destinationAccount -
 *   MUST already carry a provisioned `providerFundAccountId`
 *   (payoutAccount.service.js's resolvePayoutDestination/ensurePayoutDestination
 *   fast path) -- RazorpayX's Create Payout API only ever accepts an opaque
 *   fund_account_id, never raw bank/VPA details (Step 3A research), so this
 *   function deliberately does NOT accept or fall back to
 *   `{accountNumber, ifsc, ...}`/`{upiVpa, ...}` the way MockPayoutProvider
 *   does -- a missing `providerFundAccountId` is a deterministic failure,
 *   not a network call.
 * @param {string} [input.notes] - Free-text, e.g. `"Payout <id> (<purpose>)"`
 *   (submitPayoutToProvider's own construction) -- never destination data by
 *   construction. Capped and wrapped as a single RazorpayX `notes` key.
 * @returns {Promise<{providerPayoutId: string, providerStatus: string, raw: object}>}
 */
export async function createPayout({ idempotencyKey, amount, currency, purpose, destinationAccount, notes } = {}) {
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new Error(
      "RazorpayXPayoutProvider.createPayout requires an idempotencyKey of 4-36 characters (letters, digits, hyphen, underscore, space)."
    );
  }
  if (typeof currency !== "string" || currency.trim().toUpperCase() !== "INR") {
    // Defensive: PayoutService already enforces this (payout.service.js's
    // SUPPORTED_CURRENCY check), but a provider must not trust its caller as
    // its only safeguard -- same principle as sanitizeProviderResponse being
    // applied at every layer, not just one.
    throw new Error(`RazorpayXPayoutProvider.createPayout only supports INR; received "${currency}".`);
  }
  const razorpayPurpose = resolveRazorpayXPurpose(purpose);

  if (!destinationAccount?.providerFundAccountId) {
    // Step 3B-2 Section 2, explicit requirement: fail deterministically, no
    // provider call attempted, never fall back to raw bank details.
    throw new Error(
      "RazorpayXPayoutProvider.createPayout requires destinationAccount.providerFundAccountId -- " +
        "raw bank/VPA details cannot be submitted directly to RazorpayX's Payout API."
    );
  }
  const mode = resolveRazorpayXMode(destinationAccount);

  const amountInPaise = convertRupeesToPaise(amount);
  if (amountInPaise < MIN_PAYOUT_PAISE) {
    throw new Error(`RazorpayXPayoutProvider.createPayout requires at least ₹1 (100 paise); received ${amountInPaise} paise.`);
  }

  // The COMPANY's own RazorpayX operating current-account number -- NEVER
  // the employee/vendor's bank account number. Kept as a named local with
  // an explicit comment specifically because this distinction (our account
  // vs. theirs) is exactly the kind of mistake that would be silent and
  // catastrophic if swapped.
  const operatingAccountNumber = getRazorpayXAccountNumber();

  // reference_id reuses idempotencyKey rather than inventing a second
  // identifier: idempotencyKey is already unique per Payout
  // (Payout.idempotencyKey is @unique in the schema), deterministic, and
  // reused verbatim on every retry -- exactly what reference_id needs
  // ("same reference on retries", Step 3B-2 Section 9). idempotencyKey's own
  // 4-36 char constraint is already stricter than reference_id's 40-char
  // limit, so this never truncates in practice; the length guard below is
  // defensive, not a silent truncation of anything meaningful.
  const referenceId = idempotencyKey.length <= REFERENCE_ID_MAX_LENGTH ? idempotencyKey : idempotencyKey.slice(0, REFERENCE_ID_MAX_LENGTH);

  const narration = buildNarration(purpose, idempotencyKey);

  // Step 3B-2 Section 11: only safe metadata, capped, never destination data
  // -- `notes` here is always the free-text string
  // submitPayoutToProvider constructs ("Payout <id> (<purpose>)"), never
  // anything containing account/IFSC/VPA/credentials by construction.
  const safeNotes = notes ? { description: String(notes).slice(0, 256) } : undefined;

  try {
    const raw = await razorpayXRequest(
      "POST",
      "/payouts",
      {
        account_number: operatingAccountNumber,
        fund_account_id: destinationAccount.providerFundAccountId,
        amount: amountInPaise,
        currency: "INR",
        mode,
        purpose: razorpayPurpose,
        // Queues rather than hard-fails on temporary low balance -- RazorpayX's
        // own `queued` provider status (distinct from our internal QUEUED,
        // see payout.service.js's STATUS_MAP) is already a non-terminal state
        // syncPayoutStatus already knows to leave at PROCESSING.
        queue_if_low_balance: true,
        reference_id: referenceId,
        narration,
        notes: safeNotes,
      },
      // Idempotency is HEADER-only per RazorpayX's documented contract
      // (Step 3A research) -- never placed in the request body.
      { "X-Payout-Idempotency": idempotencyKey }
    );
    if (!raw?.id || !raw?.status) {
      throw new Error("RazorpayX payout response did not include an id/status.");
    }
    return {
      providerPayoutId: raw.id,
      providerStatus: String(raw.status).toLowerCase(),
      raw: sanitizeRazorpayXResponse(raw),
    };
  } catch (err) {
    classifyAndThrow(err);
  }
}

/**
 * @param {object} input
 * @param {string} input.providerPayoutId - RazorpayX's own payout id
 *   (`Payout.providerPayoutId`), NOT `providerResponse` -- unlike
 *   MockPayoutProvider's pure-function simulation, a real provider must ask
 *   RazorpayX directly; it cannot derive current status from a stale local
 *   snapshot.
 * @returns {Promise<{providerStatus: string, raw: object}>}
 */
export async function getPayoutStatus({ providerPayoutId } = {}) {
  if (typeof providerPayoutId !== "string" || providerPayoutId.length === 0) {
    throw new Error("RazorpayXPayoutProvider.getPayoutStatus requires providerPayoutId.");
  }

  try {
    const raw = await razorpayXRequest("GET", `/payouts/${encodeURIComponent(providerPayoutId)}`);
    if (!raw?.status) {
      throw new Error("RazorpayX payout status response did not include a status.");
    }
    return { providerStatus: String(raw.status).toLowerCase(), raw: sanitizeRazorpayXResponse(raw) };
  } catch (err) {
    classifyAndThrow(err);
  }
}

// ---------------------------------------------------------------------------
// verifyRazorpayXWebhookSignature (Payout Subsystem Step 3C).
// ---------------------------------------------------------------------------

/**
 * Verifies an inbound RazorpayX payout webhook delivery's signature, per
 * Razorpay's documented HMAC-SHA256 scheme (Step 3A research: same scheme
 * platform-wide, `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook
 * secret), hex-encoded).
 *
 * Deliberately NOT a call into razorpay.service.js's existing
 * verifyWebhookSignature (the inbound Payment Gateway's own function),
 * even though the cryptographic operation is identical -- that function
 * hardcodes reading `env.razorpay.webhookSecret` internally, and modifying
 * it to accept an override would touch inbound-gateway code this project's
 * standing rule says to leave alone ("do not modify the inbound Razorpay
 * Payment Gateway client except where absolutely necessary"). This is a
 * small, self-contained, independent reimplementation -- consistent with
 * razorpayx.client.js already reimplementing its own request layer rather
 * than reusing razorpay.client.js's SDK-based one.
 *
 * SEPARATE SECRET (explicit Step 3C requirement): reads
 * `env.razorpayx.webhookSecret` (`RAZORPAYX_WEBHOOK_SECRET`) -- NOT
 * `env.razorpay.keySecret` (API auth, already shared with the inbound
 * gateway per Step 3B-1's credential-reuse decision) and NOT
 * `env.razorpay.webhookSecret` (the INBOUND gateway's own webhook secret,
 * for a completely different Razorpay product surface / webhook URL).
 * RazorpayX lets each webhook URL configured on the dashboard carry its own
 * secret, and this payout webhook is registered at a different URL than the
 * inbound payment webhook, so it gets its own secret.
 *
 * `rawBody` MUST be the exact bytes/string RazorpayX signed -- a
 * re-serialized `JSON.stringify(parsedBody)` is not guaranteed to match
 * byte-for-byte (key order, whitespace) and would make a genuine delivery
 * fail verification. Capturing the true raw body is the caller's
 * responsibility (a route-scoped raw-body parser in app.js, mirroring the
 * inbound webhook's own setup) -- this function only ever consumes what it
 * is given.
 *
 * Throws a plain `Error` on any failure (missing input, missing config, or a
 * genuine mismatch) -- deliberately NOT `PayoutProviderError` (that class
 * signals a payout-submission outcome; signature verification is a
 * completely different concern, happening before any Payout is even
 * looked up).
 *
 * @param {object} input
 * @param {string|Buffer} input.rawBody
 * @param {string} input.signature
 * @returns {true}
 */
export function verifyRazorpayXWebhookSignature({ rawBody, signature } = {}) {
  if (rawBody == null || rawBody === "" || !signature) {
    throw new Error("verifyRazorpayXWebhookSignature requires rawBody and signature.");
  }

  const webhookSecret = env.razorpayx.webhookSecret;
  if (!webhookSecret) {
    throw new Error("RazorpayX webhook processing is not configured: RAZORPAYX_WEBHOOK_SECRET must be set.");
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  if (!safeHexEqual(expected, signature)) {
    throw new Error("RazorpayX webhook signature verification failed.");
  }

  return true;
}

/**
 * Constant-time hex-string comparison -- same reasoning and shape as
 * razorpay.service.js's own private `safeHexEqual`, duplicated rather than
 * imported (this module has no dependency on the inbound gateway's files,
 * by design). `crypto.timingSafeEqual` throws on a length mismatch rather
 * than returning false, which would itself leak timing information about
 * the expected length -- guarded here so a malformed/wrong-length signature
 * just fails cleanly.
 */
function safeHexEqual(expectedHex, providedHex) {
  if (typeof providedHex !== "string") return false;
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(providedHex, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
