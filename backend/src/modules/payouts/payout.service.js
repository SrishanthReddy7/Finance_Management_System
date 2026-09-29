// Payout domain service (Payout Subsystem Step 2). The ONLY place Payout
// rows are created or transitioned -- controllers never touch
// `prisma.payout` directly, and a PayoutProvider never contains business
// rules about reimbursements, payroll, or vendors (see
// payout-provider.interface.js's own header for that boundary).
//
// The frontend/controller is never trusted with amount or destination: each
// create* function below derives amount from the source business object
// (Reimbursement.amount, Payslip.netSalary, or the locked vendor-bill
// outstanding balance) and destination from the employee's own active,
// VERIFIED EmployeePayoutAccount -- never from the request body.
//
// ATOMIC COMPLETION (required design, confirmed before implementation): when
// a provider confirms success, "the source becomes paid" and "the Payout
// becomes PROCESSED" happen inside ONE Prisma transaction, never as two
// separate commits. This is why processReimbursement/markPayslipPaid/
// recordPayment were each given a minimal optional external-transaction-
// client parameter (see their own doc comments in expense.service.js/
// payroll.service.js/vendorBill.service.js) -- applyTerminalOutcome below is
// the one place that composes them together with the Payout row's own
// update, under a single `SELECT ... FOR UPDATE`-locked transaction. If any
// write in that transaction fails, everything rolls back: the Payout stays
// at PROCESSING (not falsely PROCESSED) and the source stays unpaid, so the
// failure is visible for retry/reconciliation rather than silently
// diverging.
//
// IDEMPOTENT COMPLETION: applyTerminalOutcome's very first act, inside the
// lock, is to check whether the payout is ALREADY terminal. A second
// identical success (or failure) delivery -- a duplicate /sync call, or,
// later, a redelivered webhook -- is recognized and safely ignored before
// any source-completion function is ever called a second time. This is a
// row-lock + status-check guard today; PayoutEvent (already in the schema)
// is reserved for a REAL webhook's own delivery-level idempotency
// (provider+eventId) once RazorpayX exists -- see the /sync doc comment
// below for why this step doesn't build that yet.

import crypto from "crypto";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { processReimbursement } from "../expenses/expense.service.js";
import { markPayslipPaid } from "../payroll/payroll.service.js";
import { recordPayment, getVendorBillOr404 } from "../vendors/vendorBill.service.js";
import { resolveActivePayoutAccount, ensurePayoutDestination } from "./payoutAccount.service.js";
import { getPayoutProvider, PayoutProviderError } from "../../integrations/payout-provider/payout-provider.interface.js";
import { PAYOUT_ENTITY_TYPE, PAYOUT_REVERSAL_ENTITY_TYPE, TERMINAL_PAYOUT_STATUSES } from "./payout.constants.js";

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const PAYABLE_VENDOR_BILL_STATUSES = ["APPROVED", "PARTIALLY_PAID"];

// Hardening pass (Step 3 audit Section 3.6): this codebase's only other
// money-movement gateway (razorpay.service.js's createOrder/createRefund)
// explicitly rejects anything but INR -- no FX/conversion exists anywhere.
// Payouts follow the same MVP boundary, enforced once here since every
// creation path funnels through createPayout() below.
const SUPPORTED_CURRENCY = "INR";

// Hardening pass (Step 3 audit Section 3.5): every payout created by this
// step is against MOCK -- there is no code path that sets `provider` to
// anything else yet. Named explicitly (rather than left implicit) so the
// MOCK-only guards below have one obvious place to update the day a second
// provider becomes selectable.
const DEFAULT_PROVIDER = "MOCK";

// Hardening pass (Step 3 audit Section 3.3): the exact transient-failure
// class this sandbox's Neon connection has repeatedly hit (Handsoff.md
// §17/18/21/24) -- a transaction that times out with no data corruption,
// safe to simply retry. Never retries a real business-rule rejection
// (AppError has no `.code`); only Prisma's own P2028 (interactive
// transaction expired).
async function withTransientRetry(fn, { attempts = 3, delayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err?.code !== "P2028") throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

// Hardening pass (Step 3 audit Section 3.2): defense in depth against
// anything sensitive ever reaching Payout.providerResponse (a plain,
// unencrypted Json column) -- applied at every write site, regardless of
// whether the provider itself (mock.provider.js's summarizeDestination, or
// a future RazorpayXPayoutProvider) already tried to keep its own response
// clean. Strips known-sensitive key names recursively rather than trusting
// any provider's response shape.
const SENSITIVE_RESPONSE_KEYS = new Set([
  "accountNumber",
  "account_number",
  "bankAccountNumber",
  "beneficiaryAccountNumber",
  "ifsc",
  "ifscCode",
  "ifsc_code",
  "upiVpa",
  "upi_vpa",
  "vpa",
  "destinationAccount",
  "bankDetails",
  "accountNumberEncrypted",
  // Step 3C: RazorpayX's own Payout create/fetch response echoes back the
  // COMPANY's own operating account number under this key -- a different
  // name than "account_number" above. Not the beneficiary's data, but this
  // is the same second-layer defense razorpayx.constants.js's own
  // sanitizeRazorpayXResponse already applies at the point RazorpayX data
  // first enters this system (webhook payload / createPayout response) --
  // duplicated here too, since this function is the LAST line of defense
  // before any Payout.providerResponse write, regardless of what already
  // sanitized the data upstream.
  "debit_account_number",
]);

function sanitizeProviderResponse(raw) {
  if (raw == null || typeof raw !== "object") return raw;
  if (Array.isArray(raw)) return raw.map(sanitizeProviderResponse);
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_RESPONSE_KEYS.has(key)) continue;
    clean[key] = value && typeof value === "object" ? sanitizeProviderResponse(value) : value;
  }
  return clean;
}

// Hardening pass (Step 3 audit Section 3.2, "logs and errors also cannot
// expose these values"): a future real provider's error message could in
// principle echo submitted routing details back (some APIs do, in
// validation errors) -- redact anything that looks like an account number
// or IFSC before it ever reaches Payout.failureReason or an AuditLog note.
function sanitizeErrorMessage(err) {
  const message = err?.message || "Payout submission failed.";
  return message.replace(/\b\d{6,}\b/g, "[REDACTED]").replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[REDACTED]");
}

function decoratePayout(payout) {
  // providerResponse is deliberately never surfaced through a normal API
  // response (schema.prisma's own design note on Payout.providerResponse).
  const { providerResponse, ...rest } = payout;
  return { ...rest, amount: round2(num(payout.amount)) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPayoutOr404(payoutId) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new AppError(404, "Payout not found.");
  return decoratePayout(payout);
}

export async function listPayouts({ status, purpose, skip, take }) {
  const where = {};
  if (status) where.status = status;
  if (purpose) where.purpose = purpose;

  const [rows, totalCount] = await Promise.all([
    prisma.payout.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    prisma.payout.count({ where }),
  ]);
  return { rows: rows.map(decoratePayout), totalCount };
}

// ---------------------------------------------------------------------------
// Creation -- one function per source, all funnelling into the shared
// createPayout() below. Amount/destination are always derived here, never
// accepted from the caller (VENDOR_PAYMENT's `amount` is the one deliberate
// exception -- see createVendorPayout's own comment).
// ---------------------------------------------------------------------------

async function createPayout(actingUser, { purpose, reimbursementId = null, payslipId = null, vendorBillId = null, amount, currency, destinationAccountId, simulate }) {
  // Hardening pass (Step 3 audit Section 3.6): enforced once here since
  // every creation path (reimbursement/salary/vendor) funnels through this
  // function -- matches razorpay.service.js's own INR-only MVP boundary.
  if (currency !== SUPPORTED_CURRENCY) {
    throw new AppError(400, `Payouts only support ${SUPPORTED_CURRENCY} currently; received "${currency}".`);
  }
  // Hardening pass (Step 3 audit Section 3.5): explicit guard, not an
  // implicit reliance on "provider always defaults to MOCK". Every payout
  // this step creates is against DEFAULT_PROVIDER, so this check is
  // structurally always true today -- it exists specifically so that
  // whoever adds real provider selection later cannot silently inherit a
  // simulate-leak without updating this line intentionally.
  if (simulate !== undefined && DEFAULT_PROVIDER !== "MOCK") {
    throw new AppError(400, "simulate is only supported for the MOCK provider.");
  }

  const payout = await prisma.payout.create({
    data: {
      purpose,
      reimbursementId,
      payslipId,
      vendorBillId,
      amount,
      currency,
      destinationAccountId,
      idempotencyKey: crypto.randomUUID(),
      status: "AWAITING_APPROVAL",
      // Step 3G production-hardening fix: previously this field was left
      // unset here and silently inherited the schema's own `@default(MOCK)`
      // -- meaning the ACTUAL activation boundary (which provider a new
      // payout uses) lived in a different file (schema.prisma) than the one
      // this module's own DEFAULT_PROVIDER guard (immediately above) already
      // assumed and documented. Writing it explicitly makes DEFAULT_PROVIDER
      // the one, single, greppable source of truth for "which provider does
      // a new payout use" -- no behavior change (it was already MOCK), but
      // activating RazorpayX for real payouts now requires deliberately
      // editing this one named constant, not a schema migration nobody
      // would think to check when reasoning about "is real money movement
      // possible yet". DEFAULT_PROVIDER remains "MOCK" -- Step 3G does not
      // activate anything.
      provider: DEFAULT_PROVIDER,
      initiatedById: actingUser.id,
      // MOCK-only, one-shot: carries the "controlled simulation" hint
      // from creation time across to the later, separate /approve request
      // that actually submits to the provider -- consumed and overwritten
      // by submitPayoutToProvider once the real provider response lands.
      // Re-checked again at submission time (submitPayoutToProvider only
      // forwards this when claimed.provider === "MOCK") -- this is the
      // creation-time half of that defense-in-depth pair, not the only one.
      providerResponse: simulate ? { pendingSimulate: simulate } : undefined,
    },
  });

  await writeAuditLog({
    entityType: PAYOUT_ENTITY_TYPE,
    entityId: payout.id,
    action: "CREATE",
    performedById: actingUser.id,
    newValue: {
      purpose,
      amount: round2(num(amount)),
      currency,
      reimbursementId,
      payslipId,
      vendorBillId,
      status: "AWAITING_APPROVAL",
    },
  });

  return decoratePayout(payout);
}

/**
 * FRS 11.1 steps 7-8's precondition, mirrored: a reimbursement must already
 * be REIMBURSEMENT_PENDING (Finance-approved) and unpaid. `amount` is always
 * Reimbursement.amount -- reimbursements are paid in full, one shot (verified
 * against the real processReimbursement contract, which accepts no amount
 * either).
 */
export async function createReimbursementPayout(actingUser, reimbursementId, { simulate } = {}) {
  const reimbursement = await prisma.reimbursement.findUnique({
    where: { id: reimbursementId },
    include: { expenseClaim: { include: { employee: true } } },
  });
  if (!reimbursement) throw new AppError(404, "Reimbursement not found.");

  if (reimbursement.expenseClaim.status !== "REIMBURSEMENT_PENDING") {
    throw new AppError(
      409,
      `The expense claim behind this reimbursement must be REIMBURSEMENT_PENDING (currently ${reimbursement.expenseClaim.status}).`
    );
  }
  if (reimbursement.paymentStatus === "PAID") {
    throw new AppError(409, "This reimbursement has already been paid.");
  }

  // Belt-and-suspenders precheck before the DB-level @unique(reimbursementId)
  // catches a genuine race -- friendlier message, same guarantee.
  const existing = await prisma.payout.findUnique({ where: { reimbursementId } });
  if (existing) throw new AppError(409, `A payout already exists for this reimbursement (status: ${existing.status}).`);

  const account = await resolveActivePayoutAccount(reimbursement.expenseClaim.employee.id);

  return createPayout(actingUser, {
    purpose: "REIMBURSEMENT",
    reimbursementId,
    amount: round2(num(reimbursement.amount)),
    currency: "INR",
    destinationAccountId: account.id,
    simulate,
  });
}

/**
 * Existing payroll maker-checker requirement, preserved: only a payslip
 * whose PayrollRun is FINALIZED (or already PAID) may be paid, matching
 * markPayslipPaid's own guard exactly. `amount` is always Payslip.netSalary
 * -- the already-finalized, immutable snapshot (FRS 12.2), never
 * recalculated here.
 */
export async function createSalaryPayout(actingUser, payslipId, { simulate } = {}) {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { payrollRun: true, employee: true },
  });
  if (!payslip) throw new AppError(404, "Payslip not found.");

  if (!payslip.payrollRun || (payslip.payrollRun.status !== "FINALIZED" && payslip.payrollRun.status !== "PAID")) {
    throw new AppError(
      409,
      `This payslip's payroll run must be FINALIZED (currently ${payslip.payrollRun?.status ?? "unknown"}).`
    );
  }
  if (payslip.paymentStatus === "PAID") {
    throw new AppError(409, "This payslip has already been paid.");
  }

  const existing = await prisma.payout.findUnique({ where: { payslipId } });
  if (existing) throw new AppError(409, `A payout already exists for this payslip (status: ${existing.status}).`);

  const account = await resolveActivePayoutAccount(payslip.employee.id);

  return createPayout(actingUser, {
    purpose: "SALARY",
    payslipId,
    amount: round2(num(payslip.netSalary)),
    currency: "INR",
    destinationAccountId: account.id,
    simulate,
  });
}

/**
 * Unlike reimbursement/salary, `amount` MAY be caller-supplied -- vendor
 * bills already legitimately support partial payment (recordVendorPaymentSchema
 * has the identical shape). Never trusted blindly: resolved against the
 * SAME outstanding-balance figure recordPayment itself derives
 * (getVendorBillOr404's decorated `.ap.outstandingAmount`), and re-checked
 * again, under the existing SELECT...FOR UPDATE lock, when recordPayment
 * actually runs at PROCESSED time -- belt and suspenders, no new locking
 * logic invented here. No vendor destination-account model exists yet
 * (only EmployeePayoutAccount does) -- destinationAccountId stays null; a
 * later stage resolves real vendor routing info from Vendor.bankDetails.
 */
export async function createVendorPayout(actingUser, vendorBillId, { amount, simulate } = {}) {
  const bill = await getVendorBillOr404(vendorBillId, actingUser);

  if (!PAYABLE_VENDOR_BILL_STATUSES.includes(bill.status)) {
    throw new AppError(409, `A payout can only be created against an approved vendor bill (currently ${bill.status}).`);
  }

  const outstanding = bill.ap.outstandingAmount;
  if (outstanding <= 0) throw new AppError(409, "This vendor bill has no outstanding balance.");

  const payoutAmount = amount ?? outstanding;
  if (payoutAmount > outstanding) {
    throw new AppError(409, `Payout amount ${payoutAmount} exceeds the ${outstanding} outstanding on this bill.`);
  }

  return createPayout(actingUser, {
    purpose: "VENDOR_PAYMENT",
    vendorBillId,
    amount: payoutAmount,
    currency: bill.currency,
    destinationAccountId: null,
    simulate,
  });
}

// ---------------------------------------------------------------------------
// Maker-checker
// ---------------------------------------------------------------------------

/**
 * Checker step. Maker != checker, enforced by comparing stored columns --
 * the same convention PayrollRun (preparedById vs finalizedById) and
 * VendorBill (createdById vs approvedById) already use, applied even to
 * SUPER_ADMIN (no bypass here, matching this codebase's existing
 * maker-checker discipline). On success, immediately (same request, but
 * strictly outside any DB transaction) attempts provider submission -- see
 * submitPayoutToProvider for why that split exists.
 */
export async function approvePayout(actingUser, payoutId) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const current = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!current) throw new AppError(404, "Payout not found.");
    if (current.status !== "AWAITING_APPROVAL") {
      throw new AppError(409, `Payout must be AWAITING_APPROVAL to approve (currently ${current.status}).`);
    }
    if (current.initiatedById === actingUser.id) {
      throw new AppError(403, "You cannot approve a payout you created yourself.");
    }

    await tx.payout.update({ where: { id: payoutId }, data: { status: "APPROVED", approvedById: actingUser.id, approvedAt: new Date() } });
    await writeAuditLog(
      {
        entityType: PAYOUT_ENTITY_TYPE,
        entityId: payoutId,
        action: "APPROVE",
        performedById: actingUser.id,
        previousValue: { status: "AWAITING_APPROVAL" },
        newValue: { status: "APPROVED" },
      },
      tx
    );
  });

  return submitPayoutToProvider(actingUser, payoutId);
}

export async function rejectPayout(actingUser, payoutId, { reason }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const current = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!current) throw new AppError(404, "Payout not found.");
    if (current.status !== "AWAITING_APPROVAL") {
      throw new AppError(409, `Payout must be AWAITING_APPROVAL to reject (currently ${current.status}).`);
    }
    if (current.initiatedById === actingUser.id) {
      throw new AppError(403, "You cannot reject a payout you created yourself.");
    }

    const updated = await tx.payout.update({ where: { id: payoutId }, data: { status: "REJECTED" } });
    await writeAuditLog(
      {
        entityType: PAYOUT_ENTITY_TYPE,
        entityId: payoutId,
        action: "REJECT",
        performedById: actingUser.id,
        previousValue: { status: "AWAITING_APPROVAL" },
        newValue: { status: "REJECTED" },
        note: reason,
      },
      tx
    );
    return decoratePayout(updated);
  });
}

/**
 * AWAITING_APPROVAL only -- never APPROVED or later (schema's own
 * CANCELLED-vs-REJECTED note). CREATED is not checked for here: every
 * payout this codebase creates goes straight to AWAITING_APPROVAL
 * (createPayout above never leaves one at CREATED), so a payout can never
 * actually be in that state when this runs -- removing the dead check
 * changes no observable behavior (hardening pass, Step 3 audit Section 4.3).
 */
export async function cancelPayout(actingUser, payoutId, { reason }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
    const current = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!current) throw new AppError(404, "Payout not found.");
    if (current.status !== "AWAITING_APPROVAL") {
      throw new AppError(409, `A payout can only be cancelled while AWAITING_APPROVAL (currently ${current.status}).`);
    }

    const updated = await tx.payout.update({ where: { id: payoutId }, data: { status: "CANCELLED" } });
    await writeAuditLog(
      {
        entityType: PAYOUT_ENTITY_TYPE,
        entityId: payoutId,
        action: "CANCEL",
        performedById: actingUser.id,
        previousValue: { status: current.status },
        newValue: { status: "CANCELLED" },
        note: reason,
      },
      tx
    );
    return decoratePayout(updated);
  });
}

// ---------------------------------------------------------------------------
// Provider submission (APPROVED/FAILED -> QUEUED -> [network call] -> PROCESSING)
// ---------------------------------------------------------------------------

/**
 * Never holds a DB transaction open across the provider call (this
 * codebase's existing rule, restated for the payout side): Step A claims
 * APPROVED|FAILED|QUEUED -> QUEUED transactionally and cheaply; the provider
 * call itself runs with no transaction open; the final step persists the
 * result in its own short transaction. A double-click / duplicate submit
 * attempt is rejected by Step A's own status check on the SECOND caller
 * (whichever request's transaction commits first wins the row).
 *
 * QUEUED RECOVERY (hardening pass, Step 3 audit Section 3.3): QUEUED is now
 * also a valid STARTING status, not just a transient one this function
 * passes through -- a payout can land here and stay here if anything after
 * the claim fails (the provider call itself, resolving the destination, or
 * persisting the result) and never get stuck permanently. Re-entering from
 * QUEUED does not re-transition or re-audit "became QUEUED" (it already is);
 * it just resumes the provider call. Every attempt -- first or retried --
 * reuses the SAME `idempotencyKey`, which is what makes this safe: a
 * well-behaved provider (and MockPayoutProvider, which derives
 * providerPayoutId deterministically from idempotencyKey) recognizes a
 * resubmission and returns the ORIGINAL result rather than creating a
 * second transfer, so a lost response never becomes a duplicate payout.
 *
 * DETERMINISTIC VS UNCERTAIN (hardening pass, Step 3 audit Section 3.3):
 * a provider that throws PayoutProviderError with isUncertain:true (its
 * result is genuinely unknown -- e.g. no HTTP response was ever received)
 * is NOT recorded as FAILED. It stays at QUEUED, flagged via
 * recordUncertainSubmission, explicitly retryable (same idempotencyKey).
 * Any other error -- a plain Error, or PayoutProviderError with
 * isUncertain:false -- is a definite rejection or an unexpected local
 * failure, recorded as FAILED (also retryable, but semantically "this did
 * not go through", not "we don't know").
 *
 * Retry never changes amount/destinationAccountId (this function accepts
 * neither), so by construction every call here is a blind retry of
 * identical parameters -- the documented retry policy's other branch,
 * "changed parameters get a new key", has no code path that could reach
 * this function with changed parameters.
 */
export async function submitPayoutToProvider(actingUser, payoutId) {
  const claimed = await withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
      const current = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!current) throw new AppError(404, "Payout not found.");
      if (!["APPROVED", "FAILED", "QUEUED"].includes(current.status)) {
        throw new AppError(409, `Payout cannot be submitted to the provider from status ${current.status}.`);
      }
      if (current.status === "QUEUED") {
        // Recovery re-entry -- already where it needs to be, no transition/
        // audit write, just proceed to the provider call below.
        return current;
      }

      const updated = await tx.payout.update({ where: { id: payoutId }, data: { status: "QUEUED" } });
      await writeAuditLog(
        {
          entityType: PAYOUT_ENTITY_TYPE,
          entityId: payoutId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { status: current.status },
          newValue: { status: "QUEUED" },
        },
        tx
      );
      return updated;
    })
  );

  let account = null;
  let destination = null;
  let providerResult;
  try {
    account = claimed.destinationAccountId
      ? await prisma.employeePayoutAccount.findUnique({ where: { id: claimed.destinationAccountId } })
      : null;

    const provider = getPayoutProvider(claimed.provider);

    // Step 3B-2.1: destination resolution now goes through
    // ensurePayoutDestination() instead of calling resolvePayoutDestination()
    // directly. ensurePayoutDestination() is a strict superset of the old
    // behavior: if the account already has a providerFundAccountId, or if
    // `provider` doesn't support ensureContact/ensureFundAccount (MOCK,
    // today), it falls through to the EXACT same resolvePayoutDestination()
    // call this used to make directly -- no behavior change for MOCK. Only
    // when the provider DOES support provisioning (RazorpayX) AND no fund
    // account is provisioned yet does this now provision one (reusing an
    // existing Contact across this employee's account rows, per Step 3B-1)
    // before returning the same `{providerFundAccountId, fundAccountType}`
    // shape a real provider's createPayout requires -- see
    // payoutAccount.service.js's own doc comment for the full contract.
    // Still resolved here, used immediately below, and explicitly discarded
    // in `finally` -- never stored, logged, or returned. Still entirely
    // outside any open Payout transaction (the claim transaction above has
    // already committed and closed; the persistence transaction below has
    // not started yet) -- provisioning's own network calls are no exception
    // to the "never hold a DB transaction open across a network call" rule.
    destination = await ensurePayoutDestination(actingUser, account, provider);

    // Hardening pass (Step 3 audit Section 3.5): explicit guard at the
    // point that actually matters -- what gets forwarded to the provider --
    // not just relying on createPayout()'s creation-time check.
    const pendingSimulate = claimed.provider === "MOCK" ? claimed.providerResponse?.pendingSimulate : undefined;

    providerResult = await provider.createPayout({
      idempotencyKey: claimed.idempotencyKey,
      amount: round2(num(claimed.amount)),
      currency: claimed.currency,
      purpose: claimed.purpose,
      destinationAccount: destination,
      notes: `Payout ${claimed.id} (${claimed.purpose})`,
      simulate: pendingSimulate,
    });
  } catch (err) {
    if (err instanceof PayoutProviderError && err.isUncertain) {
      return recordUncertainSubmission(actingUser, payoutId, err.message);
    }
    // Deterministic rejection, OR an unexpected local failure (destination
    // resolution, a DB hiccup not matching P2028's retry class, etc.) --
    // either way we did NOT get an explicit "uncertain" signal, so FAILED
    // is the safe default: retryable (QUEUED-eligible now too), never left
    // stuck.
    const { payout } = await applyTerminalOutcome(actingUser, payoutId, {
      targetStatus: "FAILED",
      failureReason: sanitizeErrorMessage(err),
    });
    return payout;
  } finally {
    account = null;
    destination = null;
  }

  const sanitizedRaw = sanitizeProviderResponse(providerResult.raw);
  return withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: "PROCESSING",
          providerPayoutId: providerResult.providerPayoutId,
          providerStatus: providerResult.providerStatus,
          providerResponse: sanitizedRaw,
        },
      });
      await writeAuditLog(
        {
          entityType: PAYOUT_ENTITY_TYPE,
          entityId: payoutId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { status: "QUEUED" },
          newValue: { status: "PROCESSING", providerPayoutId: providerResult.providerPayoutId },
        },
        tx
      );
      return decoratePayout(updated);
    })
  );
}

/**
 * Records that a provider submission's outcome is unknown, WITHOUT changing
 * status away from QUEUED (we do not know whether the provider actually
 * created a payout, so we cannot say PROCESSING, and marking it FAILED could
 * be wrong -- see submitPayoutToProvider's own doc comment). Idempotent: if
 * the payout has already moved on (a concurrent /retry or /sync resolved it
 * first), this is a safe no-op rather than overwriting that outcome.
 */
async function recordUncertainSubmission(actingUser, payoutId, message) {
  return withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
      const current = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!current) throw new AppError(404, "Payout not found.");
      if (current.status !== "QUEUED") return decoratePayout(current);

      const note = `Provider submission outcome uncertain (no confirmed response): ${sanitizeErrorMessage({ message })}. Safe to retry -- the same idempotency key will be reused, so a provider that actually received the original request will not create a duplicate.`;
      const updated = await tx.payout.update({ where: { id: payoutId }, data: { failureReason: note } });
      await writeAuditLog(
        {
          entityType: PAYOUT_ENTITY_TYPE,
          entityId: payoutId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { status: "QUEUED" },
          newValue: { status: "QUEUED" },
          note,
        },
        tx
      );
      return decoratePayout(updated);
    })
  );
}

/** Explicit, human-initiated retry -- QUEUED (stuck/uncertain submission) or FAILED (deterministic rejection) only. */
export async function retryPayout(actingUser, payoutId) {
  const payout = await getPayoutOr404(payoutId);
  if (payout.status !== "FAILED" && payout.status !== "QUEUED") {
    throw new AppError(409, `Only a FAILED or QUEUED payout can be retried (currently ${payout.status}).`);
  }
  return submitPayoutToProvider(actingUser, payoutId);
}

// ---------------------------------------------------------------------------
// Completion -- the atomic, idempotent heart of this module.
// ---------------------------------------------------------------------------

/**
 * The ONE place a payout ever reaches a terminal success/failure outcome.
 * Everything inside the `prisma.$transaction` below commits or rolls back
 * together: the source-completion write (processReimbursement/
 * markPayslipPaid/recordPayment, called with THIS SAME `tx`) and the
 * Payout row's own status update. See this file's header comment for why
 * that atomicity was a required design change, not an optimization.
 *
 * Idempotent: the row lock + immediate terminal-status check is the guard
 * against a duplicate success/failure delivery (a second /sync call, or a
 * redelivered webhook -- Step 3C's payout.webhook.service.js is the other
 * caller now) -- if the payout is ALREADY terminal, this returns early with
 * `alreadyTerminal: true` and calls NONE of the source-completion functions
 * a second time. A webhook/sync must never resurrect a terminal payout
 * (schema's own PayoutStatus rule) -- the `reachableFromCurrentStatus` check
 * below enforces that even for a non-terminal-but-wrong status (e.g. still
 * QUEUED, unless the specific QUEUED->FAILED case Step 3B-2.1 fixed).
 *
 * Wrapped in withTransientRetry (hardening pass, Step 3 audit Section 3.3):
 * the completion transaction is the other place a Neon-latency timeout could
 * otherwise strand a payout mid-flight -- safe to retry as a whole here
 * because the idempotent terminal-status check above is the very first
 * thing a retried attempt does.
 *
 * EXPORTED (Step 3C): payout.webhook.service.js calls this directly for
 * `payout.processed`/`payout.failed`/`payout.rejected`/a first-time
 * `payout.reversed` (PROCESSING -> REVERSED) -- the exact same settlement
 * algorithm `/sync` already uses, never a second reimplementation. Mirrors
 * payment.webhook.service.js importing and calling the inbound gateway's
 * exported `finalizePaymentTransaction` directly, the established
 * precedent for this exact situation in this codebase.
 */
export async function applyTerminalOutcome(actingUser, payoutId, { targetStatus, utr, providerStatus, providerResponse, failureReason }) {
  // Defense in depth (Step 3 audit Section 3.2): sanitize here too, even
  // though every caller already sanitizes at the point it received data
  // from a provider -- this is the last line of defense before a DB write.
  const sanitizedResponse = sanitizeProviderResponse(providerResponse);

  return withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
      const current = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!current) throw new AppError(404, "Payout not found.");

      if (TERMINAL_PAYOUT_STATUSES.includes(current.status)) {
        return { payout: decoratePayout(current), alreadyTerminal: true };
      }
      // Bug fix (Step 3B-2.1, found by this step's own testing -- not
      // introduced by it): this guard previously required PROCESSING
      // unconditionally, for every targetStatus. That is correct for
      // syncPayoutStatus's callers (PROCESSED/FAILED/REVERSED/CANCELLED, all
      // reached only after a payout already made it to PROCESSING) but wrong
      // for submitPayoutToProvider's OWN catch block, which calls this with
      // targetStatus "FAILED" while the payout is still QUEUED -- exactly
      // the case where provider.createPayout() (or, since Step 3B-2.1,
      // ensurePayoutDestination()) throws a DETERMINISTIC error before the
      // payout ever reaches PROCESSING. Before this fix, that call
      // unconditionally threw AppError(409) here instead of ever recording
      // FAILED -- the Payout row itself stayed untouched/QUEUED (no
      // corruption, still retryable), but the deterministic-failure path
      // this codebase has documented since Step 2.5 could never actually
      // complete; nothing before Step 3B-2.1 ever exercised it with a real
      // deterministic failure. QUEUED -> FAILED is now explicitly allowed,
      // and ONLY that one additional combination -- every other
      // still-invalid transition (e.g. AWAITING_APPROVAL/APPROVED calling
      // this directly, or QUEUED with any targetStatus other than FAILED)
      // still throws exactly as before.
      const reachableFromCurrentStatus = current.status === "PROCESSING" || (current.status === "QUEUED" && targetStatus === "FAILED");
      if (!reachableFromCurrentStatus) {
        throw new AppError(409, `Payout cannot be completed from status ${current.status}.`);
      }

      // PROCESSED and REVERSED both mean "the money moved" (REVERSED =
      // moved, then bounced back) -- the source is marked paid either way,
      // inside this same transaction. This codebase has no existing "unpay"
      // capacity for ReimbursementPayment/VendorPayment/Payslip, so a
      // REVERSED payout intentionally does NOT attempt to reverse the
      // source's PAID status -- that clawback stays a manual Finance
      // action, flagged here as a real, out-of-scope gap rather than
      // silently left unmentioned. FAILED never reaches here having
      // touched the source at all -- the money never moved.
      if (targetStatus === "PROCESSED" || targetStatus === "REVERSED") {
        await completeSourceForPurpose(actingUser, current, utr, tx);
      }

      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: targetStatus,
          processedAt: targetStatus === "FAILED" ? current.processedAt : new Date(),
          utr: utr ?? current.utr,
          providerStatus: providerStatus ?? current.providerStatus,
          providerResponse: sanitizedResponse ?? current.providerResponse,
          failureReason: targetStatus === "FAILED" ? sanitizeErrorMessage({ message: failureReason }) ?? current.failureReason : current.failureReason,
        },
      });

      await writeAuditLog(
        {
          entityType: PAYOUT_ENTITY_TYPE,
          entityId: payoutId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { status: current.status },
          newValue: { status: targetStatus, utr: utr ?? current.utr ?? null },
          note: targetStatus === "FAILED" ? failureReason : null,
        },
        tx
      );

      return { payout: decoratePayout(updated), alreadyTerminal: false };
    })
  );
}

/**
 * Records a reversal of an ALREADY-terminal (PROCESSED or FAILED) payout as
 * its own `PayoutReversal` row -- Step 3A.5's design ("READY FOR STEP 3B"
 * analysis), implemented here in Step 3C. This is a DIFFERENT case from
 * `applyTerminalOutcome`'s own `PROCESSING -> REVERSED` path (a payout
 * reversed as its first and only terminal outcome, unchanged): this function
 * is for when RazorpayX reports a reversal AFTER the payout already reached
 * PROCESSED, or -- per RazorpayX's own documented behavior -- FAILED
 * ("a transaction fails but money is debited... status changes to reversed
 * only after money is credited back").
 *
 * Deliberately NEVER touches `Payout.status`, `Payout.amount`, or any source
 * record (ReimbursementPayment/VendorPayment/Payslip) -- see
 * PayoutReversal's own schema.prisma comment for why: overwriting a
 * terminal Payout's status would erase the historical fact that it
 * genuinely processed/was attempted first, and this codebase has no "unpay"
 * capability for any source record to begin with (a known, documented,
 * out-of-scope gap). Recording a reversal is purely an audit/reconciliation
 * fact layered on top of an already-settled payout.
 *
 * Idempotent via `PayoutReversal.payoutId`'s own `@unique` constraint --
 * create-and-catch-P2002, the exact same no-race-prone pattern this
 * codebase's other event-dedup tables (PayoutEvent, PaymentGatewayEvent)
 * already use. A duplicate/out-of-order reversal signal for the same payout
 * is a safe no-op, never a second row and never an error.
 *
 * @param {{id: string}} actingUser - for the AuditLog entry; the webhook
 *   caller passes `{id: payout.initiatedById}` (no authenticated user exists
 *   for a webhook -- same convention Stage 7's PaymentTransaction.initiatedById
 *   attribution already established for the inbound side).
 * @param {string} payoutId
 * @param {object} input
 * @param {number} [input.amount] - Defaults to the payout's own original
 *   amount (a full reversal) if the caller doesn't supply one.
 * @param {string} [input.utr]
 * @param {string} [input.reason]
 * @param {object} [input.providerResponse] - Sanitized via the SAME
 *   `sanitizeProviderResponse` every other Payout-related provider write
 *   uses -- defense in depth, regardless of what the caller already
 *   sanitized upstream (mirrors `applyTerminalOutcome`'s own doc comment).
 * @returns {Promise<{reversal: object, alreadyRecorded: boolean}>}
 */
export async function recordPayoutReversal(actingUser, payoutId, { amount, utr, reason, providerResponse } = {}) {
  const current = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!current) throw new AppError(404, "Payout not found.");
  if (!["PROCESSED", "FAILED"].includes(current.status)) {
    throw new AppError(409, `A reversal can only be recorded against a PROCESSED or FAILED payout (currently ${current.status}).`);
  }

  const sanitizedResponse = sanitizeProviderResponse(providerResponse);
  const reversalAmount = round2(num(amount ?? current.amount));

  try {
    const reversal = await prisma.$transaction(async (tx) => {
      const created = await tx.payoutReversal.create({
        data: {
          payoutId,
          amount: reversalAmount,
          utr: utr ?? null,
          reason: reason ?? null,
          providerResponse: sanitizedResponse ?? undefined,
        },
      });
      await writeAuditLog(
        {
          entityType: PAYOUT_REVERSAL_ENTITY_TYPE,
          entityId: created.id,
          action: "CREATE",
          performedById: actingUser.id,
          newValue: { payoutId, amount: reversalAmount, utr: utr ?? null },
          note: reason || `RazorpayX reported this already-${current.status} payout as later reversed.`,
        },
        tx
      );
      return created;
    });
    return { reversal, alreadyRecorded: false };
  } catch (err) {
    if (err?.code === "P2002") {
      // Already recorded by an earlier delivery/attempt -- idempotent no-op.
      const existing = await prisma.payoutReversal.findUnique({ where: { payoutId } });
      return { reversal: existing, alreadyRecorded: true };
    }
    throw err;
  }
}

async function completeSourceForPurpose(actingUser, payout, utr, tx) {
  const method = "BANK_TRANSFER";

  if (payout.purpose === "REIMBURSEMENT") {
    const reimbursement = await tx.reimbursement.findUnique({
      where: { id: payout.reimbursementId },
      select: { expenseClaimId: true },
    });
    if (!reimbursement) throw new AppError(500, "The reimbursement behind this payout no longer exists.");
    await processReimbursement(actingUser, reimbursement.expenseClaimId, { method, referenceNo: utr || null }, tx);
    return;
  }

  if (payout.purpose === "SALARY") {
    const payslip = await tx.payslip.findUnique({ where: { id: payout.payslipId }, select: { payrollRunId: true } });
    if (!payslip) throw new AppError(500, "The payslip behind this payout no longer exists.");
    await markPayslipPaid(actingUser, payslip.payrollRunId, payout.payslipId, { method, referenceNo: utr || null }, tx);
    return;
  }

  if (payout.purpose === "VENDOR_PAYMENT") {
    await recordPayment(
      actingUser,
      payout.vendorBillId,
      {
        amount: round2(num(payout.amount)),
        paymentDate: new Date(),
        method,
        referenceNo: utr || null,
        note: `Payout ${payout.id} via ${payout.provider}.`,
      },
      tx
    );
    return;
  }

  throw new AppError(500, `Unknown payout purpose: ${payout.purpose}`);
}

// ---------------------------------------------------------------------------
// /sync -- Step 3D. RazorpayX's own webhook (payout.webhook.service.js,
// Step 3C) is the PRIMARY status mechanism. This function is the RECOVERY
// path for when a webhook is delayed, missed, or arrives while this
// application was unavailable, or when a provider response was accepted but
// local persistence needs re-confirming -- i.e. RECONCILIATION, not a second
// status mechanism. It remains exposed only via the one existing PATCH
// /payouts/:id/sync route (requirePayoutOperate, unchanged RBAC) -- no
// second/batch endpoint was added, and no time-based staleness rule was
// invented (this codebase has no business-defined threshold for "stuck"):
// reconciliation stays an explicit, per-payout action, exactly like /retry.
//
// THIS IS THE ONE AUTHORITATIVE RECONCILIATION IMPLEMENTATION. It reuses,
// never re-derives, the existing state machine:
//   - applyTerminalOutcome for QUEUED/PROCESSING -> a terminal outcome (same
//     row lock, idempotency guard, source-completion call, audit logging
//     the webhook path already uses -- not a second implementation).
//   - recordPayoutReversal for the "already terminal, provider now reports
//     reversed" case Step 3A.5 designed and Step 3C's webhook already
//     implements -- reused verbatim, not reimplemented here.
//
// RECONCILIATION != RETRY, RECONCILIATION != PAYOUT CREATION: this function
// never calls provider.createPayout, never invents a providerPayoutId, and
// never creates a second Payout row. A QUEUED payout with no
// providerPayoutId yet (an uncertain submission that never received one --
// see recordUncertainSubmission) has nothing to ask the provider about;
// /retry, not /sync, is the correct recovery path for that specific state,
// unchanged since Step 2.5 -- this function returns the current state
// unchanged rather than guessing or fabricating an id.
//
// ELIGIBLE PAYOUTS:
//   - QUEUED / PROCESSING, with a providerPayoutId: the primary
//     reconciliation case -- ask the provider, apply whatever status it
//     reports via the same mapping/transition rules this route has always
//     used (extended only to also recognize RazorpayX's documented
//     "initiated" as another non-terminal alias for "submitted but not yet
//     terminal", alongside the existing "queued"/"processing"/"pending").
//   - PROCESSED / FAILED (already terminal): reconciliation may still query
//     the provider here, but ONLY to catch a reversal that happened after
//     settlement and was never delivered by webhook (the same Step
//     3A.5/Step 3C "already terminal" reversal case) -- Payout.status/
//     amount are NEVER touched by this branch. Any other provider status
//     observed (including a stale/out-of-order "processing"/"pending" left
//     over from before the payout settled) is read and discarded, never
//     regresses the terminal local state. This is the one place terminal
//     payouts are ever reconciled -- no other terminal status (REJECTED/
//     CANCELLED/REVERSED) is queried, since none of them can reach the
//     provider a second time in this system's design.
//   - Everything else -- AWAITING_APPROVAL/APPROVED/REJECTED/CANCELLED/
//     REVERSED, or QUEUED/PROCESSING with no providerPayoutId yet: a safe
//     no-op, current state returned unchanged.
//
// PROVIDER CALL NEVER INSIDE A TRANSACTION: exactly one call to
// provider.getPayoutStatus(), with no Prisma transaction/row lock held
// across it (unchanged since Step 3B-2) -- only the SHORT persistence step
// AFTER the provider has already responded runs inside a transaction/lock
// (applyTerminalOutcome's own, or recordPayoutReversal's own). Two
// concurrent reconciliation requests for the same payout cannot create
// duplicate financial side effects: applyTerminalOutcome's row-lock +
// already-terminal guard and recordPayoutReversal's own
// PayoutReversal.payoutId @unique constraint are the existing safety nets
// this function relies on rather than re-implements.
//
// PROVIDER ERRORS ARE NOT EVIDENCE OF PAYOUT FAILURE: if
// provider.getPayoutStatus() itself throws, NOTHING about the Payout row is
// touched -- the error is mapped (mapReconciliationError, distinguishing
// PayoutProviderError.isUncertain the same way submitPayoutToProvider's own
// catch block does) onto a sanitized AppError and surfaced to the caller;
// local state is preserved for a later retry.
// ---------------------------------------------------------------------------

/**
 * An error querying the provider is never proof the payout itself failed --
 * this only ever produces an AppError to surface to the caller, called
 * strictly BEFORE any Payout row write, so local state is always left
 * exactly as it was. Mirrors this codebase's existing provider-error-mapping
 * convention (payment.service.js's own mapRazorpayError/mapSignatureError)
 * -- never forwards raw provider detail to the caller.
 */
function mapReconciliationError(err) {
  if (err instanceof PayoutProviderError) {
    // eslint-disable-next-line no-console
    console.error("[payouts] Reconciliation: error querying provider status", {
      isUncertain: err.isUncertain,
      message: sanitizeErrorMessage(err),
    });
    return new AppError(
      500,
      err.isUncertain
        ? "Could not reach the payout provider to check status right now; the payout's local status is unchanged. Safe to retry reconciliation later."
        : "The payout provider rejected the status check; the payout's local status is unchanged."
    );
  }
  // eslint-disable-next-line no-console
  console.error("[payouts] Reconciliation: unexpected error querying provider status", { message: err?.message });
  return new AppError(500, "Could not check payout status with the provider right now; the payout's local status is unchanged.");
}

/** Strips providerResponse before a PayoutReversal ever reaches an API response -- same discipline decoratePayout already applies to Payout. */
function decorateReversal(reversal) {
  if (!reversal) return reversal;
  const { providerResponse, ...rest } = reversal;
  return { ...rest, amount: round2(num(reversal.amount)) };
}

export async function syncPayoutStatus(actingUser, payoutId) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new AppError(404, "Payout not found.");

  const isActiveReconcilable = ["QUEUED", "PROCESSING"].includes(payout.status);
  // Step 3D: terminal payouts are reconciled ONLY to catch a reversal
  // reported after settlement -- never for any other status change.
  const isReversalCheckOnly = ["PROCESSED", "FAILED"].includes(payout.status);

  if ((!isActiveReconcilable && !isReversalCheckOnly) || !payout.providerPayoutId) {
    // Nothing to reconcile via the provider -- not yet submitted, a terminal
    // status with no reversal semantics to re-check (REJECTED/CANCELLED/
    // REVERSED), or QUEUED with no providerPayoutId yet (Step 3D Section 3/
    // 11: an uncertain submission /retry must resolve, never /sync). Never
    // fabricates a providerPayoutId and never calls provider.createPayout --
    // reconciliation is not retry, and not payout creation.
    return decoratePayout(payout);
  }

  const provider = getPayoutProvider(payout.provider);
  let outcome;
  try {
    outcome = await provider.getPayoutStatus({
      providerPayoutId: payout.providerPayoutId,
      providerResponse: payout.providerResponse,
    });
  } catch (err) {
    // Step 3D Section 7: local state is left completely untouched -- this
    // throw happens before any Payout write is even attempted.
    throw mapReconciliationError(err);
  }
  // Hardening pass (Step 3 audit Section 3.2): sanitize immediately at the
  // boundary where data enters this system from the provider, before it is
  // used for anything else.
  const sanitizedRaw = sanitizeProviderResponse(outcome.raw);

  if (isReversalCheckOnly) {
    if (outcome.providerStatus !== "reversed") {
      // Out-of-order protection (Step 3D Section 8): any other provider
      // status -- including a stale "processing"/"pending" left over from
      // before this payout settled -- is discarded. A terminal PROCESSED/
      // FAILED payout is never regressed or otherwise mutated here.
      return decoratePayout(payout);
    }
    // Deliberately NOT reading an amount off outcome.raw here: its unit/shape
    // is provider-specific (RazorpayX reports paise; MockPayoutProvider's own
    // `raw` echoes the rupee amount it was given) -- exactly the kind of
    // provider detail payout.service.js must stay agnostic to (payout-
    // provider.interface.js's own contract). recordPayoutReversal's own
    // default (the payout's own already-known, authoritative `amount`) is
    // correct here regardless of provider -- RazorpayX payout reversal is
    // documented as all-or-nothing, never partial, so there is no case where
    // a reversal amount could legitimately differ from the original payout.
    const { reversal, alreadyRecorded } = await recordPayoutReversal(actingUser, payoutId, {
      utr: outcome.raw?.utr,
      reason: "Reconciliation (/sync) detected a provider-side reversal after settlement.",
      providerResponse: sanitizedRaw,
    });
    return { ...decoratePayout(payout), reversal: decorateReversal(reversal), reversalAlreadyRecorded: alreadyRecorded };
  }

  // isActiveReconcilable (QUEUED/PROCESSING) from here down.
  //
  // Step 3B-2 (Step 3A design): RazorpayX's own provider-side `queued` means
  // "insufficient balance in our operating account" and `pending` means
  // "awaiting RazorpayX's own approval workflow" -- NEITHER is our internal
  // PayoutStatus.QUEUED (which means "claimed for submission, outstanding/
  // recoverable"). "initiated" (Step 3D: Step 3A's documented status list)
  // is a third non-terminal alias with the same meaning. All three are
  // simply non-terminal at the provider: this payout has already been
  // submitted, so they resolve to "stay as-is, just record the provider's
  // own status string for observability" -- the same treatment "processing"
  // already got before this step.
  if (["queued", "processing", "pending", "initiated"].includes(outcome.providerStatus)) {
    const updated = await withTransientRetry(() =>
      prisma.payout.update({
        where: { id: payoutId },
        data: { providerStatus: outcome.providerStatus, providerResponse: sanitizedRaw },
      })
    );
    return decoratePayout(updated);
  }

  // "rejected"/"cancelled" mapped defensively (Step 3A design): neither
  // should occur in practice (RazorpayX's own Approval Workflow / explicit
  // payout-cancel API are not used anywhere in this codebase), but a real
  // getPayoutStatus response must never 500 here if either is ever reported
  // -- "rejected" (RazorpayX-side rejection, a DIFFERENT concept from this
  // system's own maker-checker PayoutStatus.REJECTED, which only ever
  // happens pre-submission) resolves to FAILED, same as any other
  // provider-side rejection; "cancelled" resolves to our own CANCELLED for
  // the closest semantic match, even though every existing CANCELLED
  // transition in this codebase today is pre-submission.
  const STATUS_MAP = { processed: "PROCESSED", failed: "FAILED", reversed: "REVERSED", rejected: "FAILED", cancelled: "CANCELLED" };
  const targetStatus = STATUS_MAP[outcome.providerStatus];
  if (!targetStatus) throw new AppError(500, `Unrecognized provider status: ${outcome.providerStatus}`);

  // applyTerminalOutcome's OWN idempotency guard (already-terminal ->
  // alreadyTerminal:true, no mutation) already absorbs the case where a
  // concurrent webhook/sync resolved this payout first -- not reimplemented
  // here (Step 3D Section 9).
  const { payout: updated } = await applyTerminalOutcome(actingUser, payoutId, {
    targetStatus,
    utr: outcome.raw?.utr,
    providerStatus: outcome.providerStatus,
    providerResponse: sanitizedRaw,
    failureReason:
      targetStatus === "FAILED"
        ? outcome.providerStatus === "rejected"
          ? "Provider rejected this payout."
          : "Provider reported this payout as failed."
        : undefined,
  });
  return updated;
}
