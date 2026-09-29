// EmployeePayoutAccount: resolve/validate the active account for
// PayoutService, and the one minimal set/get pair Step 2 builds (no full
// verification workflow/UI -- out of scope, per the approved architecture).

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { encryptField, decryptField, lastFourDigits } from "../../utils/fieldEncryption.js";
import { PAYOUT_ACCOUNT_ENTITY_TYPE } from "./payout.constants.js";
import { PayoutProviderError } from "../../integrations/payout-provider/payout-provider.interface.js";

/**
 * Never returns the encrypted account number or any provider secret. Only
 * `accountNumberLast4` (already-safe-to-display) and a derived mask reach a
 * caller -- same redaction-at-the-service-layer convention
 * Vendor.bankDetails already uses in this codebase, applied here with actual
 * encryption at rest underneath it too (schema.prisma's own design note).
 *
 * This is the shape for DISPLAY (API responses). It is NOT what a payout
 * provider needs to actually move money -- see resolvePayoutDestination
 * below for that, a deliberately separate function so the two purposes can
 * never be confused at a call site.
 */
export function redactAccount(account) {
  if (!account) return account;
  const { accountNumberEncrypted, ...rest } = account;
  return {
    ...rest,
    maskedAccountNumber: account.accountNumberLast4 ? `••••${account.accountNumberLast4}` : null,
  };
}

/**
 * Step 3G production-hardening fix (a pre-existing, already-documented gap
 * flagged in Handsoff.md Step 3B-1/§34, now fixed here since it is directly
 * in this step's own "logging/sensitive data" scope and the fix is small
 * and safe): masks a UPI VPA the same way `redactAccount` already masks a
 * bank account number -- the local part (before "@") is never logged, only
 * the handle/bank suffix, which alone identifies no one. Used ONLY for
 * AuditLog/log output; never for `resolvePayoutDestination`'s own provider-
 * facing shape, which still needs the real value.
 */
function maskVpa(vpa) {
  if (typeof vpa !== "string" || !vpa.includes("@")) return null;
  const [, handle] = vpa.split("@");
  return `••••@${handle}`;
}

/**
 * Step 3G: same reasoning as maskVpa above, applied to IFSC. The first 4
 * letters (bank code) are already public information Razorpay/every bank
 * publishes (e.g. "HDFC", "ICIC") -- not sensitive on their own -- but the
 * branch-identifying suffix is masked, consistent with never logging a full
 * routing detail that, combined with an account number, identifies a
 * specific beneficiary's branch.
 */
function maskIfsc(ifsc) {
  if (typeof ifsc !== "string" || ifsc.length < 4) return null;
  return `${ifsc.slice(0, 4)}${"X".repeat(ifsc.length - 4)}`;
}

/**
 * Resolves what a PAYOUT PROVIDER needs to actually move money -- the
 * opposite concern from redactAccount above. Hardening pass, Step 3 audit
 * Section 3.1: submitPayoutToProvider previously (incorrectly) passed
 * redactAccount()'s masked output to the provider, which no real provider
 * could act on.
 *
 * Prefers `providerFundAccountId` (an opaque reference already provisioned
 * with the provider) when one exists on the account -- nothing sensitive
 * ever needs decrypting in that case. Falls back to decrypting the raw
 * bank/UPI details ONLY when no fund account has been provisioned yet.
 *
 * `fundAccountType` (Payout Subsystem Step 3B-2): included alongside
 * `providerFundAccountId` so a real provider can pick a payout MODE
 * (RazorpayX needs `UPI` vs `NEFT`/`RTGS`/`IMPS`) without a network lookup or
 * ever seeing raw routing details again -- RazorpayX's Create Payout API
 * only ever accepts an opaque `fund_account_id` (Step 3A research), so this
 * is the only way the provider learns bank-vs-VPA once a fund account is
 * already provisioned. Not sensitive: a type discriminator
 * (`"bank_account"`/`"vpa"`), never routing information itself.
 *
 * CALLER CONTRACT: call this ONLY immediately before the provider call that
 * consumes its result, in the same expression/short-lived variable -- never
 * store, log, return, or persist what this returns. The account number this
 * may return is plaintext, decrypted specifically for that one call.
 */
export function resolvePayoutDestination(account) {
  if (!account) return null;
  if (account.providerFundAccountId) {
    return {
      providerFundAccountId: account.providerFundAccountId,
      fundAccountType: account.upiVpa ? "vpa" : "bank_account",
    };
  }
  if (account.upiVpa) {
    return { upiVpa: account.upiVpa, accountHolderName: account.accountHolderName };
  }
  if (account.accountNumberEncrypted) {
    return {
      accountNumber: decryptField(account.accountNumberEncrypted),
      ifsc: account.ifsc,
      accountHolderName: account.accountHolderName,
    };
  }
  return null;
}

/**
 * Resolves (provisioning if necessary) the opaque provider-side destination
 * reference a REAL provider's createPayout needs -- Payout Subsystem
 * Step 3B-1. NOT wired into submitPayoutToProvider yet (that is Step 3B-2);
 * this function is complete and independently usable/testable today.
 *
 * Architecture (as specified for this step):
 *
 *   EmployeePayoutAccount
 *           |
 *   ensurePayoutDestination()
 *           |
 *   providerFundAccountId exists?
 *          /              \
 *        YES               NO
 *         |                 |
 *   return existing   ensure Contact (reused across this employee's
 *         id                account rows, see below) -> create Fund
 *                            Account -> persist provider ids -> return
 *
 * FAST PATH: if `account.providerFundAccountId` is already set, this is a
 * pure read -- no network call, matching resolvePayoutDestination's own
 * existing "prefer providerFundAccountId" behavior.
 *
 * MOCK / capability detection: if `provider` doesn't export
 * ensureContact/ensureFundAccount (MockPayoutProvider today), this falls
 * back to the existing synchronous resolvePayoutDestination() unchanged --
 * the mock has no real Contact/Fund Account concept and should not be given
 * one.
 *
 * CONTACT REUSE (explicit requirement for this step): an employee can have
 * several EmployeePayoutAccount rows over time (bank details change), but
 * must map to exactly ONE RazorpayX Contact -- the employee themselves
 * hasn't changed, only their bank account. Rather than adding a new column
 * or table for this, a prior sibling row for the SAME employee that already
 * has a `providerContactId` is looked up and reused (EmployeePayoutAccount
 * rows are never deleted -- setActivePayoutAccount's own existing
 * convention -- so this lookup is reliable). Only when no sibling has one is
 * a brand-new Contact created via ensureContact(). A new Fund Account is
 * ALWAYS created for a row that doesn't have one yet -- fund accounts are
 * immutable at RazorpayX (cannot be edited), so a changed bank account
 * genuinely needs a new one; only the Contact is shared.
 *
 * CRASH SAFETY / IDEMPOTENCY: RazorpayX deduplicates both Contact creation
 * (by name+email+contact+type+reference_id) and Fund Account creation (by
 * contact_id + the matching bank_account/vpa fields) server-side -- see
 * razorpayx.provider.js's own header comment. Because this function always
 * derives `referenceId` from the stable Employee.id and re-derives
 * `destination` fresh from the same stored encrypted account data on every
 * call, simply RE-CALLING this function after any failure (including a
 * crash between a successful provider call and the local DB write) is safe:
 * RazorpayX returns the SAME contact/fund-account id it returned the first
 * time, never a duplicate. `providerContactId` is persisted as soon as it is
 * known (before attempting Fund Account creation), so a retry that already
 * has a Contact never re-provisions one.
 *
 * SECURITY: `destination` (which may carry a decrypted plaintext account
 * number) is resolved via the existing resolvePayoutDestination() -- same
 * "decrypt immediately before the one call that needs it, then discard"
 * contract -- and is never logged, persisted, or included in the AuditLog
 * entry this function writes (only the resulting opaque ids are).
 *
 * CALLER CONTRACT: `account` must already be the correct, active, verified
 * account (e.g. resolved via resolveActivePayoutAccount) -- this function
 * does not re-check isActive/verificationStatus itself, matching
 * resolvePayoutDestination's own existing scope (single responsibility:
 * given an account, resolve its provider destination).
 *
 * @param {{id: string}} actingUser - for the AuditLog entry only.
 * @param {object} account - a full EmployeePayoutAccount row.
 * @param {{ensureContact?: Function, ensureFundAccount?: Function}} provider
 * @returns {Promise<{providerContactId: string|null, providerFundAccountId: string}|object>}
 *   Either `{providerContactId, providerFundAccountId}` (real provisioning
 *   path) or resolvePayoutDestination's own return shape (fallback path) --
 *   both are directly usable as a provider's `destinationAccount` argument.
 */
export async function ensurePayoutDestination(actingUser, account, provider) {
  // Bug fix (Step 3B-2.1): mirrors resolvePayoutDestination's own null
  // guard, required now that submitPayoutToProvider calls this directly --
  // a VENDOR_PAYMENT payout has no EmployeePayoutAccount at all
  // (destinationAccountId stays null, no vendor destination-account model
  // exists yet), so `account` legitimately arrives as `null` here. Without
  // this guard, the property access below would throw a raw TypeError
  // instead of correctly resolving to "no destination", which is exactly
  // the deterministic-failure signal RazorpayXPayoutProvider.createPayout
  // already surfaces for a missing providerFundAccountId.
  if (!account) return null;
  if (account.providerFundAccountId) {
    return {
      providerFundAccountId: account.providerFundAccountId,
      fundAccountType: account.upiVpa ? "vpa" : "bank_account",
    };
  }

  if (typeof provider?.ensureFundAccount !== "function" || typeof provider?.ensureContact !== "function") {
    return resolvePayoutDestination(account);
  }

  let providerContactId = account.providerContactId;
  let reusedContact = Boolean(providerContactId);

  if (!providerContactId) {
    const priorAccountWithContact = await prisma.employeePayoutAccount.findFirst({
      where: { employeeId: account.employeeId, providerContactId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { providerContactId: true },
    });
    if (priorAccountWithContact?.providerContactId) {
      providerContactId = priorAccountWithContact.providerContactId;
      reusedContact = true;
    }
  }

  if (!providerContactId) {
    const employee = await prisma.employee.findUnique({
      where: { id: account.employeeId },
      include: { user: { select: { email: true } } },
    });
    if (!employee) throw new AppError(404, "Employee not found while provisioning a payout destination.");

    const contactResult = await provider.ensureContact({
      referenceId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      email: employee.user?.email || undefined,
      phone: employee.phone || undefined,
      type: "employee",
    });
    providerContactId = contactResult.providerContactId;
    reusedContact = false;
  }

  // Persist the Contact id as soon as it's known, even before Fund Account
  // creation is attempted -- if Fund Account creation fails, a retry should
  // never have to re-provision the Contact.
  if (account.providerContactId !== providerContactId) {
    await prisma.employeePayoutAccount.update({
      where: { id: account.id },
      data: { providerContactId },
    });
  }

  let destination = resolvePayoutDestination(account);
  let fundAccountResult;
  try {
    fundAccountResult = await provider.ensureFundAccount({ providerContactId, destination });
  } finally {
    destination = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.employeePayoutAccount.update({
      where: { id: account.id },
      data: { providerFundAccountId: fundAccountResult.providerFundAccountId },
    });
    await writeAuditLog(
      {
        entityType: PAYOUT_ACCOUNT_ENTITY_TYPE,
        entityId: account.id,
        action: "UPDATE",
        performedById: actingUser.id,
        newValue: { providerContactId, providerFundAccountId: fundAccountResult.providerFundAccountId },
        note: reusedContact
          ? "Provisioned a RazorpayX Fund Account; reused an existing Contact for this employee."
          : "Provisioned a new RazorpayX Contact and Fund Account.",
      },
      tx
    );
    return row;
  });

  return {
    providerContactId: updated.providerContactId,
    providerFundAccountId: updated.providerFundAccountId,
    // Same mode-selection hint resolvePayoutDestination's own fast path now
    // includes (Step 3B-2) -- kept consistent so both return shapes are
    // equally usable as a provider's destinationAccount argument.
    fundAccountType: updated.upiVpa ? "vpa" : "bank_account",
  };
}

/**
 * PayoutService's own internal lookup -- throws with a clear reason rather
 * than returning null, so a payout-creation caller gets one consistent
 * AppError shape. `client` lets a caller already inside a transaction (none
 * of PayoutService's creation paths currently need that, but kept for the
 * same reason writeAuditLog does) pass its own tx.
 */
export async function resolveActivePayoutAccount(employeeId, client = prisma) {
  const account = await client.employeePayoutAccount.findFirst({ where: { employeeId, isActive: true } });
  if (!account) {
    throw new AppError(409, "This employee has no active payout account. Add one before creating a payout.");
  }
  if (account.verificationStatus !== "VERIFIED") {
    throw new AppError(
      409,
      `This employee's active payout account is not verified (status: ${account.verificationStatus}). A payout cannot be created until it is.`
    );
  }
  return account;
}

export async function getActivePayoutAccount(employeeId) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new AppError(404, "Employee not found.");

  const account = await prisma.employeePayoutAccount.findFirst({ where: { employeeId, isActive: true } });
  if (!account) throw new AppError(404, "This employee has no active payout account.");
  return redactAccount(account);
}

/**
 * Replaces the employee's active account: deactivates whichever row is
 * currently active (if any) and creates a new one, atomically. Old rows are
 * NEVER deleted -- kept for history, so a Payout already paid against one
 * keeps a valid, historically accurate destinationAccountId.
 *
 * Locking (audit decision, schema.prisma's EmployeePayoutAccount.isActive
 * comment): pg_advisory_xact_lock serializes concurrent "set active account"
 * calls for the SAME employee, the identical primitive createPayrollRun uses
 * for its own duplicate-period race -- without it, two concurrent calls could
 * both read "no active account yet" and both insert one as isActive:true.
 * The database's own partial unique index
 * (EmployeePayoutAccount_employeeId_active_key, WHERE isActive = true) is
 * the backstop if this lock is ever bypassed -- it turns that race into a
 * loud constraint-violation error instead of two silently-active rows -- but
 * the lock is what makes the deactivate-then-activate pair atomic in the
 * first place, so a concurrent caller waits and proceeds cleanly rather than
 * hitting that error at all.
 */
export async function setActivePayoutAccount(actingUser, employeeId, input) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new AppError(404, "Employee not found.");

  const lockKey = `payout-account:${employeeId}`;

  const account = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const previousActive = await tx.employeePayoutAccount.findFirst({ where: { employeeId, isActive: true } });
    if (previousActive) {
      await tx.employeePayoutAccount.update({ where: { id: previousActive.id }, data: { isActive: false } });
    }

    const accountNumberEncrypted = input.accountNumber ? encryptField(input.accountNumber) : null;
    const accountNumberLast4 = input.accountNumber ? lastFourDigits(input.accountNumber) : null;
    const verificationStatus = input.verificationStatus ?? "UNVERIFIED";

    const created = await tx.employeePayoutAccount.create({
      data: {
        employeeId,
        accountHolderName: input.accountHolderName,
        accountNumberEncrypted,
        accountNumberLast4,
        ifsc: input.ifsc ?? null,
        upiVpa: input.upiVpa ?? null,
        verificationStatus,
        verifiedAt: verificationStatus === "VERIFIED" ? new Date() : null,
        isActive: true,
      },
    });

    // Never the account number, encrypted or otherwise -- same redaction
    // discipline the AuditLog gets for Vendor.bankDetails today. Step 3G
    // fix: the VPA/IFSC were previously logged in full plaintext here (a
    // pre-existing gap flagged in Handsoff.md Step 3B-1/§34) -- both are now
    // masked the same way the account number already was, closing the one
    // production-logging gap this module had.
    await writeAuditLog(
      {
        entityType: PAYOUT_ACCOUNT_ENTITY_TYPE,
        entityId: created.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          employeeId,
          accountHolderName: created.accountHolderName,
          last4: accountNumberLast4,
          maskedIfsc: maskIfsc(created.ifsc),
          maskedUpiVpa: maskVpa(created.upiVpa),
          verificationStatus: created.verificationStatus,
        },
        note: previousActive ? `Replaces previous active account ${previousActive.id}.` : null,
      },
      tx
    );
    if (previousActive) {
      await writeAuditLog(
        {
          entityType: PAYOUT_ACCOUNT_ENTITY_TYPE,
          entityId: previousActive.id,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue: { isActive: true },
          newValue: { isActive: false },
          note: `Deactivated -- replaced by ${created.id}.`,
        },
        tx
      );
    }

    return created;
  });

  return redactAccount(account);
}

// ---------------------------------------------------------------------------
// Fund Account Validation (Payout Subsystem Step 3E) -- an OPTIONAL,
// provider-neutral capability for checking whether a beneficiary's bank/VPA
// details are real and active, as an alternative/supplement to the existing
// manual `POST /employees/:id/payout-account` self-certified `verificationStatus`.
//
// STATUS (read this before extending): Step 3E's own read-only research
// (current official RazorpayX docs, fetched fresh) confirmed RazorpayX's
// real Account Validation capability is NOT available in Test Mode at all,
// and is available only for a RazorpayX *Lite* account -- a fact about the
// actual production RazorpayX account this project has never established.
// RazorpayXPayoutProvider therefore deliberately does NOT implement
// validateFundAccount/getFundAccountValidationStatus (see
// payout-provider.interface.js's own header). The two functions below are
// PROVIDER-NEUTRAL and work today against MockPayoutProvider's deterministic
// test implementation ONLY -- calling them with any provider that doesn't
// export the capability (RazorpayX, today) fails cleanly with a 409, never
// silently falls back to the manual path or pretends to validate anything.
//
// The existing manual verification path (setActivePayoutAccount's
// `verificationStatus` input, above) is UNCHANGED and remains available --
// this is an additive, optional path, not a replacement. See Handsoff.md
// Step 3E for the full capability writeup and the RBAC/schema questions
// explicitly flagged there for a future decision, not resolved here.
//
// NOT PERSISTED (deliberate, Section 11's "prefer no schema change"):
// `EmployeePayoutAccount` has no column to hold a validation attempt's
// provider-side id or its in-flight ("created") state -- adding one is a
// proposed, NOT performed, schema change (see Handsoff.md). Until a
// validation attempt reaches a terminal outcome, NOTHING is written to the
// database: `verificationStatus` is only ever touched once
// checkFundAccountValidation observes status "completed" or "failed". The
// caller is responsible for holding `providerValidationId`/`raw` between the
// two calls (exactly as `getFundAccountValidationStatus`'s own doc comment
// requires) -- there is no server-side session for an in-flight validation.
//
// FINANCIAL SAFETY (Step 3E Section 8, verified by construction): neither
// function below creates, retries, or transitions a Payout, touches a
// Reimbursement/Payslip/VendorPayment, or creates a PayoutReversal -- both
// only ever read/write EmployeePayoutAccount.verificationStatus/verifiedAt
// plus one AuditLog row.
// ---------------------------------------------------------------------------

/**
 * Mirrors payout.service.js's own mapReconciliationError (Step 3D) --
 * exactly the same provider-error-mapping convention this codebase already
 * established (payment.service.js's mapRazorpayError/mapSignatureError),
 * duplicated here rather than imported to avoid a circular import
 * (payout.service.js itself imports FROM this file). Never forwards raw
 * provider detail; distinguishes PayoutProviderError.isUncertain purely for
 * caller clarity.
 */
function mapValidationError(err) {
  if (err instanceof PayoutProviderError) {
    // eslint-disable-next-line no-console
    console.error("[payouts] Fund account validation: provider error", { isUncertain: err.isUncertain, message: err.message });
    return new AppError(
      500,
      err.isUncertain
        ? "Could not reach the payout provider to validate this account right now; nothing was changed. Safe to retry later."
        : "The payout provider rejected the validation request; nothing was changed."
    );
  }
  // eslint-disable-next-line no-console
  console.error("[payouts] Fund account validation: unexpected provider error", { message: err?.message });
  return new AppError(500, "Could not validate this account with the provider right now; nothing was changed.");
}

/**
 * Initiates a fund-account validation attempt against the employee's
 * currently active EmployeePayoutAccount. Never writes `verificationStatus`
 * itself -- initiation only ever proves a request was accepted, never that
 * the account is valid (Step 3E Section 2's explicit safety rule); call
 * checkFundAccountValidation with this function's own return value to learn
 * the outcome.
 *
 * Destination resolution mirrors resolvePayoutDestination exactly (prefers
 * an already-provisioned providerFundAccountId; decrypts raw bank/UPI
 * details only as a last resort, for the duration of this one call) -- the
 * SAME security discipline every other provider call in this file already
 * follows. Never sends raw bank details when destination.providerFundAccountId
 * is already known -- consistent with real RazorpayX's own Validate Fund
 * Account endpoint, which only ever accepts an opaque fund_account_id
 * (Step 3E research), never raw account details inline.
 *
 * @param {{id: string}} actingUser - for the AuditLog entry only.
 * @param {string} employeeId
 * @param {{validateFundAccount?: Function}} provider
 * @returns {Promise<{providerValidationId: string, status: string, raw: object}>}
 */
export async function requestFundAccountValidation(actingUser, employeeId, provider) {
  if (typeof provider?.validateFundAccount !== "function") {
    throw new AppError(409, `Fund account validation is not supported by provider "${provider?.PROVIDER_NAME || "unknown"}".`);
  }

  const account = await prisma.employeePayoutAccount.findFirst({ where: { employeeId, isActive: true } });
  if (!account) {
    throw new AppError(409, "This employee has no active payout account to validate.");
  }

  let destination = resolvePayoutDestination(account);
  let result;
  try {
    result = await provider.validateFundAccount({ destinationAccount: destination, currency: "INR" });
  } catch (err) {
    // Step 3E Section 8/2: a provider error at initiation is not evidence of
    // anything about the account -- nothing is written, mirroring Step 3D's
    // own "provider errors are not evidence of payout failure" discipline.
    throw mapValidationError(err);
  } finally {
    // Same "decrypt only for the duration of this one call, then discard"
    // contract resolvePayoutDestination's own doc comment requires.
    destination = null;
  }

  await writeAuditLog({
    entityType: PAYOUT_ACCOUNT_ENTITY_TYPE,
    entityId: account.id,
    action: "UPDATE",
    performedById: actingUser.id,
    // Deliberately NOT `raw` -- only the opaque id and the attempt's own
    // in-flight status, matching ensurePayoutDestination's own AuditLog
    // convention of never logging a provider's raw response. This is the
    // strongest form of "pass provider responses through the existing
    // sanitizer before persistence" (Step 3E Section 6): nothing raw is
    // persisted at all.
    newValue: { providerValidationId: result.providerValidationId, status: result.status },
    note: "Fund account validation requested; verificationStatus not yet changed.",
  });

  return result;
}

/**
 * Resolves a previously-initiated validation attempt and, ONLY on a
 * terminal provider outcome, updates `verificationStatus`:
 *   - status "completed" + accountStatus "active"  -> VERIFIED
 *   - status "completed" + accountStatus "invalid" -> FAILED
 *   - status "failed" (a technical failure, not a verdict on the account
 *     itself -- RazorpayX's own documented meaning, Step 3E research) -> FAILED,
 *     since this system cannot claim an unconfirmed account is safe to pay
 *   - status "created" (still awaiting the beneficiary bank's response) ->
 *     no write at all; `verificationStatus` stays exactly as it was
 *
 * Mirrors payout.service.js's syncPayoutStatus in spirit (a reconciliation-
 * style status check that never regresses or guesses), but is a much
 * smaller surface: there is no in-flight status value to persist (Section
 * 11), so "still validating" is never observable as a stored
 * `verificationStatus` -- only genuinely terminal outcomes are ever written.
 *
 * @param {{id: string}} actingUser
 * @param {string} employeeId
 * @param {{getFundAccountValidationStatus?: Function}} provider
 * @param {{providerValidationId: string, raw: object}} attempt - the object
 *   requestFundAccountValidation returned (or a prior call to this function).
 * @returns {Promise<{status: string, accountStatus: string|null, account: object}>}
 */
export async function checkFundAccountValidation(actingUser, employeeId, provider, attempt) {
  if (typeof provider?.getFundAccountValidationStatus !== "function") {
    throw new AppError(409, `Fund account validation is not supported by provider "${provider?.PROVIDER_NAME || "unknown"}".`);
  }
  if (!attempt?.providerValidationId) {
    throw new AppError(400, "A providerValidationId from a prior requestFundAccountValidation call is required.");
  }

  const account = await prisma.employeePayoutAccount.findFirst({ where: { employeeId, isActive: true } });
  if (!account) {
    throw new AppError(409, "This employee has no active payout account to validate.");
  }

  const outcome = await provider.getFundAccountValidationStatus({
    providerValidationId: attempt.providerValidationId,
    providerResponse: attempt.raw,
  });

  if (outcome.status !== "completed" && outcome.status !== "failed") {
    // Still "created" -- genuinely nothing to record yet (Step 3E Section 2:
    // never interpret an in-flight request as a verdict). verificationStatus
    // is left exactly as it was.
    return { status: outcome.status, accountStatus: null, account: redactAccount(account) };
  }

  const nextVerificationStatus = outcome.status === "completed" && outcome.accountStatus === "active" ? "VERIFIED" : "FAILED";

  const updated = await prisma.employeePayoutAccount.update({
    where: { id: account.id },
    data: {
      verificationStatus: nextVerificationStatus,
      verifiedAt: nextVerificationStatus === "VERIFIED" ? new Date() : account.verifiedAt,
    },
  });

  await writeAuditLog({
    entityType: PAYOUT_ACCOUNT_ENTITY_TYPE,
    entityId: account.id,
    action: "UPDATE",
    performedById: actingUser.id,
    previousValue: { verificationStatus: account.verificationStatus },
    newValue: { verificationStatus: nextVerificationStatus, providerValidationStatus: outcome.status, accountStatus: outcome.accountStatus },
    note: "Fund account validation resolved via provider.",
  });

  return { status: outcome.status, accountStatus: outcome.accountStatus, account: redactAccount(updated) };
}
