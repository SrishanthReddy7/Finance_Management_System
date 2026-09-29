// PayoutProvider contract + registry (Payout Subsystem Step 2). The one place
// PayoutService looks up a provider implementation by name -- mirrors
// razorpay.client.js being the one place allowed to construct the Razorpay
// SDK, so provider-specific code stays isolated behind a single seam.
//
// Every provider module (mock/mock.provider.js today; a future
// razorpayx/razorpayx.provider.js) must export exactly:
//
//   async function createPayout({ idempotencyKey, amount, currency, purpose,
//     destinationAccount, notes })
//     -> { providerPayoutId: string, providerStatus: string, raw: object }
//
//   `destinationAccount` (hardening pass, Step 3 audit Section 3.1) is
//   resolved by PayoutService's own resolvePayoutDestination() immediately
//   before this call -- either `{ providerFundAccountId }` (preferred, an
//   opaque already-provisioned reference) or, only when no fund account has
//   been provisioned yet, raw decrypted routing info
//   (`{ accountNumber, ifsc, accountHolderName }` or `{ upiVpa,
//   accountHolderName }`). A provider implementation must not persist this
//   object or echo it back verbatim into `raw` -- PayoutService sanitizes
//   `raw` before storing it regardless, but a provider should not rely on
//   that as its only safeguard.
//
//   function|async function getPayoutStatus({ providerPayoutId, providerResponse })
//     -> { providerStatus: string, raw: object }
//
// A provider implementation MUST NOT:
//   - import PrismaClient or know about Reimbursement/Payslip/VendorBill/
//     EmployeePayoutAccount -- it receives only the plain values it needs
//   - decide eligibility, amounts, or purpose -- that is entirely
//     PayoutService's job (see payout.service.js's own header comment)
//   - hold a database transaction open across its own call (this codebase's
//     "never hold a DB transaction open during an external network call"
//     rule -- PayoutService is responsible for calling provider methods
//     OUTSIDE any open Prisma transaction)
// A provider implementation MAY:
//   - make a real external network call (both methods are async-safe)
//   - validate its own input shape and throw a plain Error on bad input --
//     PayoutService wraps/interprets these, the same way payment.service.js
//     interprets RazorpayError from razorpay.service.js
//
// ERROR CLASSIFICATION (hardening pass, Step 3 audit Section 12.C): a
// provider that can distinguish "definitely rejected" from "no confirmed
// response, outcome unknown" (e.g. a network timeout) MUST throw
// PayoutProviderError with `isUncertain` set accordingly, mirroring
// RazorpayError's role on the money-in side. PayoutService branches on this:
// a deterministic rejection is recorded as FAILED (retryable); an uncertain
// one leaves the payout at QUEUED for safe reconciliation (same
// idempotencyKey reused, never a second payout). A provider that throws a
// plain Error is treated as a deterministic failure by default -- only
// PayoutProviderError can signal uncertainty.
//
// getPayoutStatus is intentionally the ONLY status-sync mechanism this step
// builds. A real RazorpayX integration's primary path will be an inbound
// webhook calling straight into PayoutService's own completion functions
// (mirroring payment.webhook.service.js's relationship to payment.service.js)
// -- getPayoutStatus/the /payouts/:id/sync route that calls it exist as a
// polling FALLBACK/reconciliation mechanism, not the intended primary path,
// so nothing about this contract should end up baked into an assumption that
// a frontend must keep calling /sync.
//
// OPTIONAL CAPABILITIES (Payout Subsystem Step 3B-1): a provider MAY also
// export two additional, OPTIONAL functions, used only for provisioning a
// payout destination BEFORE createPayout is ever called -- never invoked by
// PayoutService's own submission path directly, only by
// payoutAccount.service.js's ensurePayoutDestination():
//
//   async function ensureContact({ referenceId, name, email, phone, type })
//     -> { providerContactId: string, raw: object }
//
//   async function ensureFundAccount({ providerContactId, destination })
//     -> { providerFundAccountId: string, raw: object }
//
// These exist because RazorpayX's real Create Payout API only ever accepts
// an opaque `fund_account_id` -- it has no path for submitting raw bank/VPA
// details inline (Step 3A research) -- so a real provider needs its own
// one-time provisioning step to turn raw destination details into that
// opaque id, cached on EmployeePayoutAccount.providerContactId/
// providerFundAccountId (see payoutAccount.service.js) once resolved. Not
// part of the REQUIRED createPayout/getPayoutStatus contract:
// MockPayoutProvider does not (and should not) implement them, and a caller
// MUST feature-detect (`typeof provider.ensureFundAccount === "function"`)
// rather than assume every provider supports provisioning. See
// razorpayx/razorpayx.provider.js for the first (and so far only)
// implementation.
//
// OPTIONAL CAPABILITY -- FUND ACCOUNT VALIDATION (Payout Subsystem Step 3E):
// a provider MAY additionally export a two-call pair, deliberately shaped
// like createPayout/getPayoutStatus's own create-then-poll pattern, for
// checking whether a beneficiary's bank/VPA details are real and active
// BEFORE any real money is ever sent to them:
//
//   async function validateFundAccount({ destinationAccount, amount, currency })
//     -> { providerValidationId: string, status: "created"|"completed"|"failed",
//          raw: object }
//
//   `destinationAccount` is the SAME shape createPayout's own
//   `destinationAccount` argument already uses (resolvePayoutDestination's
//   return value: `{providerFundAccountId, fundAccountType}` when a fund
//   account is already provisioned, or raw decrypted bank/UPI details as a
//   last resort) -- not a second, different destination shape.
//
//   async function getFundAccountValidationStatus({ providerValidationId,
//     providerResponse })
//     -> { status: "created"|"completed"|"failed",
//          accountStatus: "active"|"invalid"|null, raw: object }
//
// `status` and `accountStatus` are deliberately two different axes, per
// RazorpayX's own documented lifecycle (Step 3E research, current official
// docs): `status` says whether the VALIDATION ATTEMPT has finished running
// ("created" = still awaiting the beneficiary bank's response -- Razorpay's
// own docs explicitly warn against paying an account while its validation is
// still in this state; "completed" = a result is available; "failed" = a
// technical failure, e.g. the beneficiary bank has IMPS disabled, not a
// verdict on the account itself). `accountStatus` (only meaningful once
// `status === "completed"`) is the actual verdict: "active" or "invalid". A
// caller MUST NOT treat "completed" as "account valid" -- that is exactly
// the `accountStatus` field's job, kept separate on purpose (see Section 2 of
// Step 3E's own instructions: "validation request created" is never the same
// fact as "bank account verified").
//
// NOT part of the required createPayout/getPayoutStatus contract.
// MockPayoutProvider implements a deterministic test version (see
// mock/mock.provider.js) so the ABSTRACTION itself is exercisable and
// testable. **RazorpayXPayoutProvider deliberately does NOT implement this
// capability** -- Step 3E's own read-only research (current official
// RazorpayX docs, fetched fresh, not assumed) confirmed Account Validation
// is NOT available in RazorpayX Test Mode at all, and is available only for
// a RazorpayX *Lite* account specifically -- a fact about the actual
// production RazorpayX account this project has never established, and one
// no amount of code in this sandbox (which has no real RazorpayX account at
// all) can confirm or work around. The real endpoint
// (`POST /fund_accounts/validations`) also requires a distinct RazorpayX
// Lite "Customer Identifier" credential (from the RazorpayX Dashboard,
// different per Test/Live mode) that is NOT the same value as this
// codebase's existing `RAZORPAYX_ACCOUNT_NUMBER` (the company's own
// operating current account, used by the Payout API's `account_number`
// field) -- implementing this for real would need a new, currently-absent
// config value this project has no basis to invent. A caller MUST
// feature-detect (`typeof provider.validateFundAccount === "function"`)
// rather than assume every provider supports validation -- exactly the same
// discipline `ensureContact`/`ensureFundAccount` above already established.

import * as mockProvider from "./mock/mock.provider.js";
import * as razorpayXProvider from "./razorpayx/razorpayx.provider.js";

// Payout Subsystem Step 3B-2: RazorpayXPayoutProvider now implements both
// required methods (createPayout/getPayoutStatus), so it is registered here.
// This does NOT change which provider any payout actually uses today --
// payout.service.js's own `DEFAULT_PROVIDER` constant is still hardcoded to
// "MOCK", and no code path anywhere sets `Payout.provider` to anything else
// (it relies on the schema's own `@default(MOCK)`) -- so registering
// RazorpayX here only makes it SELECTABLE via getPayoutProvider("RAZORPAYX"),
// it does not select it. Switching the actual default is a separate,
// deliberate decision this step does not make.
const PROVIDERS = {
  MOCK: mockProvider,
  RAZORPAYX: razorpayXProvider,
};

/**
 * Thrown by a provider implementation to signal a payout-submission outcome
 * PayoutService must handle specially. `isUncertain: true` means the call's
 * result is genuinely unknown (e.g. no HTTP response was ever received) --
 * NOT the same as a definite rejection, and must never be recorded as FAILED
 * (see submitPayoutToProvider's own handling). `isUncertain: false` (the
 * default, and what a plain thrown Error is also treated as) means the
 * provider positively rejected the request.
 */
export class PayoutProviderError extends Error {
  constructor(message, { isUncertain = false } = {}) {
    super(message);
    this.name = "PayoutProviderError";
    this.isUncertain = Boolean(isUncertain);
  }
}

/**
 * @param {string} providerName - A `PayoutProvider` enum value.
 * @returns {{createPayout: Function, getPayoutStatus: Function}}
 */
export function getPayoutProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (provider) return provider;

  // Step 3B-2: RAZORPAYX is now registered above, so this branch is only
  // reached for a genuinely unknown provider name.
  throw new Error(`Unknown payout provider: ${providerName}`);
}
