// MockPayoutProvider (Payout Subsystem Step 2). Development/testing provider
// standing in for RazorpayXPayoutProvider -- the company has no RazorpayX
// account yet. Moves NO real money, makes NO network calls, and holds NO
// Prisma/business-rule knowledge (see the payout-provider.interface.js file
// header for the contract every provider must follow).
//
// Deliberately never returns an instantly-terminal status from createPayout:
// a payout always starts "queued" and progresses through "processing" before
// reaching a terminal outcome, so the async PayoutStatus lifecycle
// (QUEUED -> PROCESSING -> PROCESSED/FAILED/REVERSED) is actually observable
// and testable, not faked as a single synchronous step.
//
// Statelessness: this provider holds no state of its own between calls.
// getPayoutStatus is a pure function of the `providerResponse` JSON the
// caller (PayoutService) already persisted from the prior createPayout/
// getPayoutStatus call -- exactly what a REAL provider integration would
// instead ask RazorpayX for over the network, so swapping this module for
// RazorpayXPayoutProvider later requires no change to PayoutService's own
// call shape.
//
// Idempotency (hardening pass, Step 3 audit Section 3.3): providerPayoutId
// is DERIVED DETERMINISTICALLY from idempotencyKey (a hash), not randomly
// generated, specifically so that resubmitting the SAME idempotencyKey --
// exactly what happens when PayoutService retries a QUEUED payout whose
// original outcome was uncertain -- yields the SAME providerPayoutId, the
// same way a real provider's own idempotency handling would recognize the
// duplicate and return the original result rather than creating a second
// transfer. This stays stateless (no stored state needed) because it's a
// pure function of the input.
//
// Sensitive-data boundary: this provider never persists (into its own `raw`
// response) anything beyond a safe summary of the destination it was given
// -- see summarizeDestination. It receives decrypted routing info only for
// the duration of this call and never stores or echoes it back verbatim.

import crypto from "crypto";
import { PayoutProviderError } from "../payout-provider.interface.js";

export const PROVIDER_NAME = "MOCK";

// Short, fixed delays (not configurable) so a manual smoke test naturally
// observes queued -> processing -> terminal without an artificially long
// wait, while still being genuinely time-based rather than instant.
const PROCESSING_AFTER_MS = 400;
const READY_AFTER_MS = 1200;

// PROCESSED/FAILED/REVERSED control the EVENTUAL outcome (read back via
// getPayoutStatus, after a successful submission). UNCERTAIN is a different
// axis entirely -- it makes createPayout() itself throw a PayoutProviderError
// with isUncertain:true, simulating a submission whose outcome was never
// confirmed (e.g. a network timeout), for exercising PayoutService's
// QUEUED-recovery path.
const VALID_SIMULATED_OUTCOMES = ["PROCESSED", "FAILED", "REVERSED", "UNCERTAIN"];

function randomToken(length) {
  return crypto.randomBytes(length).toString("hex");
}

function deterministicId(seed, prefix) {
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20);
  return `${prefix}_${hash}`;
}

function generateUtr() {
  return `MOCKUTR${randomToken(6).toUpperCase()}`;
}

/**
 * Reduces whatever PayoutService resolved as the destination down to a
 * summary safe to keep in this provider's own `raw` response -- never the
 * account number, IFSC, or UPI VPA themselves. A real provider's own
 * response wouldn't echo those back either.
 */
function summarizeDestination(destinationAccount) {
  if (!destinationAccount) return null;
  if (destinationAccount.providerFundAccountId) {
    return { type: "fund_account", providerFundAccountId: destinationAccount.providerFundAccountId };
  }
  if (destinationAccount.upiVpa) {
    return { type: "upi" };
  }
  if (destinationAccount.accountNumber) {
    return { type: "bank", last4: String(destinationAccount.accountNumber).replace(/\D/g, "").slice(-4) };
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} input.idempotencyKey - Echoed back into `raw`; a real
 *   provider would use this to deduplicate retried submissions.
 * @param {number} input.amount - Major currency unit (rupees), matching
 *   razorpay.service.js's own amount convention.
 * @param {string} input.currency
 * @param {string} input.purpose - REIMBURSEMENT | SALARY | VENDOR_PAYMENT --
 *   accepted only for inclusion in the mock's own audit-friendly `raw`
 *   payload. Never inspected or branched on: the provider must not know or
 *   care what kind of payout this is.
 * @param {object} [input.destinationAccount] - Routing info PayoutService's
 *   resolvePayoutDestination() already resolved (a `providerFundAccountId`
 *   reference, or decrypted bank/UPI details as a last resort) -- reduced to
 *   a safe summary (summarizeDestination) before ever being kept in `raw`;
 *   never persisted or echoed back as received.
 * @param {string} [input.notes]
 * @param {"PROCESSED"|"FAILED"|"REVERSED"|"UNCERTAIN"} [input.simulate] -
 *   MOCK-only controlled-simulation hint (Financial Safety / testing
 *   requirement). PROCESSED/FAILED/REVERSED control the eventual outcome
 *   (read back via getPayoutStatus); UNCERTAIN makes THIS call itself throw
 *   a PayoutProviderError with isUncertain:true, simulating a submission
 *   whose result was never confirmed. Meaningless for any real provider --
 *   PayoutService must never forward this to RazorpayXPayoutProvider.
 * @returns {Promise<{providerPayoutId: string, providerStatus: string, raw: object}>}
 */
export async function createPayout({ idempotencyKey, amount, currency, purpose, destinationAccount, notes, simulate } = {}) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new Error("MockPayoutProvider.createPayout requires idempotencyKey.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("MockPayoutProvider.createPayout requires a positive numeric amount.");
  }
  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw new Error("MockPayoutProvider.createPayout requires a currency code.");
  }
  if (simulate !== undefined && !VALID_SIMULATED_OUTCOMES.includes(simulate)) {
    throw new Error(`MockPayoutProvider simulate must be one of ${VALID_SIMULATED_OUTCOMES.join(", ")}.`);
  }

  if (simulate === "UNCERTAIN") {
    // No providerPayoutId is generated or returned -- an uncertain
    // submission means we do not know whether the provider created
    // anything at all. idempotencyKey is what makes a later retry safe.
    throw new PayoutProviderError(
      "Simulated uncertain outcome: no response was received from the provider.",
      { isUncertain: true }
    );
  }

  // Deterministic, not random (see this file's header comment): the SAME
  // idempotencyKey always yields the SAME providerPayoutId, so a retried
  // submission (PayoutService's QUEUED-recovery path) is recognized as the
  // same payout rather than creating a second one.
  const providerPayoutId = deterministicId(idempotencyKey, "mock_pout");
  const now = Date.now();

  const plan = {
    mock: true,
    idempotencyKey,
    amount,
    currency,
    purpose: purpose ?? null,
    destinationSummary: summarizeDestination(destinationAccount),
    notes: notes ?? null,
    outcome: simulate || "PROCESSED",
    createdAt: now,
    processingAt: now + PROCESSING_AFTER_MS,
    readyAt: now + READY_AFTER_MS,
  };

  return {
    providerPayoutId,
    providerStatus: "queued",
    raw: plan,
  };
}

/**
 * Pure: derives the current simulated status from the previously-persisted
 * `providerResponse`. Never touches a database or the network.
 *
 * @param {object} input
 * @param {string} input.providerPayoutId
 * @param {object} input.providerResponse - The `raw` payload this same
 *   provider returned from createPayout (or a prior getPayoutStatus call).
 * @returns {{providerStatus: string, raw: object}}
 */
export function getPayoutStatus({ providerPayoutId, providerResponse } = {}) {
  if (typeof providerPayoutId !== "string" || providerPayoutId.length === 0) {
    throw new Error("MockPayoutProvider.getPayoutStatus requires providerPayoutId.");
  }

  const plan = providerResponse && providerResponse.mock ? providerResponse : null;
  if (!plan) {
    // No simulation plan on record -- nothing this provider created, or the
    // caller lost the plan. Report queued rather than guessing a terminal
    // state.
    return { providerStatus: "queued", raw: providerResponse ?? null };
  }

  const now = Date.now();

  if (now < plan.processingAt) {
    return { providerStatus: "queued", raw: plan };
  }
  if (now < plan.readyAt) {
    return { providerStatus: "processing", raw: plan };
  }

  const TERMINAL_STATUS_BY_OUTCOME = { PROCESSED: "processed", FAILED: "failed", REVERSED: "reversed" };
  const providerStatus = TERMINAL_STATUS_BY_OUTCOME[plan.outcome] || "processed";
  const utr = providerStatus === "processed" || providerStatus === "reversed" ? plan.utr || generateUtr() : null;

  return {
    providerStatus,
    raw: { ...plan, utr, resolvedAt: now },
  };
}

// ---------------------------------------------------------------------------
// validateFundAccount / getFundAccountValidationStatus (Payout Subsystem
// Step 3E) -- the OPTIONAL Fund Account Validation capability
// (payout-provider.interface.js's own header). Deliberately shaped like
// createPayout/getPayoutStatus's create-then-poll pair, and deliberately NOT
// instantly terminal from validateFundAccount, so the ABSTRACTION faithfully
// exercises the genuinely asynchronous "created -> completed/failed" lifecycle
// RazorpayX's real Account Validation API documents (Step 3E research) --
// even though this provider makes no network call and moves no real time.
// RazorpayXPayoutProvider deliberately does NOT implement this pair (see
// payout-provider.interface.js's header for why) -- this exists purely so
// PayoutService-adjacent code has something real to call and test against
// without pretending RazorpayX's own capability is confirmed available.
// ---------------------------------------------------------------------------

// Deliberately more generous than createPayout's own PROCESSING_AFTER_MS
// (400ms) -- a validation-initiation call already does a DB write
// (requestFundAccountValidation's own AuditLog entry) before a caller can
// even reach a status check, and this sandbox's own documented Neon latency
// (Handsoff.md, repeatedly) can make that single round trip alone take
// longer than 400ms. 1500ms leaves headroom for a normal call sequence to
// still observe "created" reliably, matching createPayout's own READY_AFTER_MS
// (1200ms) at a similar order of magnitude.
const VALIDATION_READY_AFTER_MS = 1500;
const VALID_SIMULATED_ACCOUNT_STATUSES = ["active", "invalid"];

/**
 * @param {object} input
 * @param {object} [input.destinationAccount] - Same shape
 *   resolvePayoutDestination()/createPayout's own `destinationAccount`
 *   already uses (`{providerFundAccountId}` or raw bank/UPI details) --
 *   reduced to a safe summary before ever being kept in `raw`, exactly like
 *   createPayout above; never persisted or echoed back as received.
 * @param {"active"|"invalid"} [input.simulateAccountStatus] - MOCK-only
 *   controlled-simulation hint (mirrors createPayout's own `simulate`) for
 *   the eventual `accountStatus` a later getFundAccountValidationStatus call
 *   will report. Defaults to "active". A DIFFERENT axis from createPayout's
 *   `simulate` (PROCESSED/FAILED/REVERSED/UNCERTAIN) -- this is about
 *   whether a bank ACCOUNT looks real, not about a PAYOUT's own outcome.
 * @param {"REJECTED"|"UNCERTAIN"} [input.simulate] - MOCK-only, controls the
 *   INITIATION call itself rather than the eventual result (mirrors
 *   createPayout's `simulate: "UNCERTAIN"` exactly). "REJECTED" throws a
 *   plain Error immediately (deterministic -- no providerValidationId is
 *   ever created); "UNCERTAIN" throws PayoutProviderError with
 *   isUncertain:true (genuinely unknown whether a validation transaction was
 *   created at all -- e.g. a network timeout).
 * @returns {Promise<{providerValidationId: string, status: "created", raw: object}>}
 */
export async function validateFundAccount({ destinationAccount, simulateAccountStatus, simulate } = {}) {
  if (simulateAccountStatus !== undefined && !VALID_SIMULATED_ACCOUNT_STATUSES.includes(simulateAccountStatus)) {
    throw new Error(`MockPayoutProvider simulateAccountStatus must be one of ${VALID_SIMULATED_ACCOUNT_STATUSES.join(", ")}.`);
  }
  if (simulate === "REJECTED") {
    throw new Error("Simulated deterministic rejection: the provider refused to create a validation transaction.");
  }
  if (simulate === "UNCERTAIN") {
    throw new PayoutProviderError(
      "Simulated uncertain outcome: no response was received from the provider.",
      { isUncertain: true }
    );
  }
  if (simulate !== undefined) {
    throw new Error('MockPayoutProvider.validateFundAccount simulate must be one of "REJECTED", "UNCERTAIN".');
  }

  const providerValidationId = `mock_fav_${randomToken(10)}`;
  const now = Date.now();

  const plan = {
    mock: true,
    destinationSummary: summarizeDestination(destinationAccount),
    accountStatus: simulateAccountStatus || "active",
    createdAt: now,
    readyAt: now + VALIDATION_READY_AFTER_MS,
  };

  // Never instantly "completed" -- RazorpayX's own documented lifecycle
  // (Step 3E research) starts every validation transaction at "created"
  // ("awaiting a response from the beneficiary's bank"); a caller must poll
  // getFundAccountValidationStatus, exactly as it would for a real provider.
  return { providerValidationId, status: "created", raw: plan };
}

/**
 * Pure: derives the current simulated status from the previously-returned
 * `raw` plan -- never touches a database or the network, mirroring
 * getPayoutStatus's own statelessness. The CALLER is responsible for holding
 * onto `providerResponse` between the two calls (Payout Subsystem Step 3E:
 * no schema change was made to persist a validation attempt, so nothing here
 * assumes durable storage exists for one).
 *
 * @param {object} input
 * @param {string} input.providerValidationId
 * @param {object} input.providerResponse - The `raw` payload
 *   validateFundAccount (or a prior call to this function) returned.
 * @returns {{status: "created"|"completed", accountStatus: "active"|"invalid"|null, raw: object}}
 */
export function getFundAccountValidationStatus({ providerValidationId, providerResponse } = {}) {
  if (typeof providerValidationId !== "string" || providerValidationId.length === 0) {
    throw new Error("MockPayoutProvider.getFundAccountValidationStatus requires providerValidationId.");
  }

  const plan = providerResponse && providerResponse.mock ? providerResponse : null;
  if (!plan) {
    return { status: "created", accountStatus: null, raw: providerResponse ?? null };
  }

  const now = Date.now();
  if (now < plan.readyAt) {
    return { status: "created", accountStatus: null, raw: plan };
  }

  return {
    status: "completed",
    accountStatus: plan.accountStatus,
    raw: { ...plan, resolvedAt: now },
  };
}
