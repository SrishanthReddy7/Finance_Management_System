// Payments module -- business logic (Payment Gateway Stages 5-6).
//
// Stage 5 scope: ONLINE PAYMENT INITIATION -- create a Razorpay order for an
// invoice's current outstanding balance and persist it as a PaymentTransaction
// (status PENDING).
//
// Stage 6 scope: PAYMENT VERIFICATION + FINALIZATION -- verify a completed
// Razorpay payment's signature, then create the ClientPayment/mark the
// PaymentTransaction VERIFIED/derive the invoice's payment status, all
// inside one invoice-row-locked transaction.
//
// Neither stage:
//   - processes webhooks or writes PaymentGatewayEvent rows (Stage 7)
//   - implements refunds (Stage 10+)
//   - calls the Razorpay SDK directly (always through razorpay.service.js)
//
// Stage 10 scope (corrected -- maker/checker split): refund INITIATION and
// refund SUBMISSION are two separate, separately-permissioned functions,
// per the approved Stage 8 design's maker-checker requirement.
//   - initiateRefund() (INITIATE_REFUND, the maker): locks the ClientPayment
//     row (not the Invoice row -- a refund never touches Invoice/AR, see
//     below), computes the refundable balance, and persists a PaymentRefund
//     row with status REQUESTED. Performs NO Razorpay call whatsoever.
//   - approveRefund() (APPROVE_REFUND, the checker -- must be a different
//     user than the one who requested it): atomically claims the REQUESTED
//     row (REQUESTED -> PROCESSING via a conditional updateMany, the actual
//     concurrency boundary -- see claimRefundForSubmission), THEN calls
//     Razorpay outside any transaction/lock. Submission success fills in
//     gatewayRefundId (stays PROCESSING, never PROCESSED -- final
//     confirmation is refund.processed/refund.failed webhook handling,
//     deferred to a later stage). A deterministic rejection moves the claim
//     to FAILED; an uncertain (network/timeout, no HTTP response) outcome
//     REVERTS the claim back to REQUESTED -- never retried, never left as a
//     bare PROCESSING-with-no-gatewayRefundId.
// Per the approved Stage 8 design (Model 1): a refund NEVER touches
// Invoice.status, computeInvoiceOutstanding(), or applyPaymentStatus() -- AR
// does not reopen. ClientPayment itself is never mutated by a refund.
//
// The existing manual flow (POST /invoices/:id/payments -> recordPayment) is
// untouched in its public behavior and remains the way non-gateway payments
// are recorded; it now shares the same invoice-row lock as Stage 6's
// verification path (see invoice.service.js) so the two can never both
// succeed against the same balance.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { computeInvoiceOutstanding, applyPaymentStatus, PAYABLE_STATUSES } from "../invoice/invoice.service.js";
import { createOrder, verifyPaymentSignature, createRefund } from "../../integrations/payment-gateway/razorpay/razorpay.service.js";
import { RazorpayError, RAZORPAY_ERROR_CODES, RAZORPAY_PROVIDER } from "../../integrations/payment-gateway/razorpay/razorpay.constants.js";
import { env } from "../../config/env.js";

const ENTITY_TYPE = "PaymentTransaction"; // Stage 5's own constant, unchanged
const CLIENT_PAYMENT_ENTITY_TYPE = "ClientPayment"; // matches invoice.service.js's own PAYMENT_ENTITY_TYPE value

// ClientPayment.method is a free-text `String` column, NOT a Prisma enum
// (confirmed by inspecting prisma/schema.prisma before writing this --
// Stage 6 Section 10) -- the manual-recording endpoint's Zod schema happens
// to constrain it to a fixed list (invoice.validation.js's PAYMENT_METHODS),
// but that schema is never used on this write path, so introducing a new
// value here requires no schema change, no migration, and no edit to that
// unrelated list. "RAZORPAY" matches PaymentGatewayProvider's own enum value
// for easy correlation in reports/audit.
const CLIENT_PAYMENT_METHOD = "RAZORPAY";

// PaymentTransactionStatus values that mean "there is already an unresolved
// gateway attempt for this invoice" (Stage 5, Section 11). FAILED/CANCELLED/
// VERIFIED are terminal and never block a new attempt.
const ACTIVE_TRANSACTION_STATUSES = ["CREATED", "PENDING"];

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const INVOICE_SELECT = { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true };

/**
 * Same eligibility rule applied twice (once as an optimistic pre-check,
 * once inside the locked re-validation) -- kept in one place so the two
 * checks cannot silently drift apart.
 */
function assertInvoiceEligibleForOnlinePayment(invoice) {
  if (!invoice) throw new AppError(404, "Invoice not found.");

  if (!PAYABLE_STATUSES.includes(invoice.status)) {
    const message =
      invoice.status === "PAID"
        ? "This invoice is already fully paid."
        : invoice.status === "CANCELLED"
          ? "This invoice has been cancelled and cannot be paid."
          : `An online payment can only be initiated for an invoice that has been sent to the client. This one is ${invoice.status}.`;
    throw new AppError(409, message);
  }

  // Stage 2 correction, Section J / Stage 4: the Razorpay wrapper only knows
  // how to convert INR -> paise (no FX). Checked here too, not only inside
  // razorpay.service.js, so the caller gets a clear invoice-shaped reason
  // before any gateway call is attempted.
  if ((invoice.currency || "").toUpperCase() !== "INR") {
    throw new AppError(
      409,
      `Online payment is only available for INR invoices in this stage; invoice ${invoice.invoiceNumber} is in ${invoice.currency}.`
    );
  }
}

/**
 * Short, Razorpay-receipt-safe (Razorpay's documented limit is 40 chars),
 * deterministic per invoice, and reversible by a support engineer who has
 * the invoice id on hand -- the hyphens are dropped from the UUID rather
 * than encoding anything else, so this reveals nothing beyond what the
 * invoice id itself already is.
 */
function buildReceipt(invoiceId) {
  return `pay_${invoiceId.replace(/-/g, "")}`; // "pay_" + 32 hex chars = 36
}

/** Never forwards raw SDK/provider detail to the caller -- see Section 6/19/20. */
function mapRazorpayError(err, { invoiceId }) {
  if (!(err instanceof RazorpayError)) {
    // eslint-disable-next-line no-console
    console.error("[payments] Unexpected error calling Razorpay", { invoiceId });
    return new AppError(500, "Online payment order creation failed.");
  }

  // eslint-disable-next-line no-console
  console.error("[payments] Razorpay order creation failed", { invoiceId, code: err.code, message: err.message });

  switch (err.code) {
    case RAZORPAY_ERROR_CODES.CONFIG_MISSING:
      return new AppError(500, "Online payments are not configured. Contact an administrator.");
    case RAZORPAY_ERROR_CODES.UNSUPPORTED_CURRENCY:
      return new AppError(409, "Online payment is only available for INR invoices in this stage.");
    case RAZORPAY_ERROR_CODES.INVALID_INPUT:
      return new AppError(400, "Invalid payment order request.");
    case RAZORPAY_ERROR_CODES.API_ERROR:
    default:
      return new AppError(500, "The payment gateway could not create the order. Please try again.");
  }
}

/**
 * Initiates an online payment for an invoice:
 *   1. (fast, lock-free) validate the invoice and quote the outstanding
 *      amount -- avoids wasting a Razorpay call on an obviously ineligible
 *      invoice, but is NOT itself the concurrency-safety boundary.
 *   2. create the Razorpay order for that amount, outside any DB transaction
 *      (Stage 5 Section 10: never hold a row lock across a slow external
 *      call).
 *   3. (short, locked) re-validate everything that could have changed since
 *      step 1 under `SELECT ... FOR UPDATE` on the invoice row -- the same
 *      pattern vendorBill.service.js's recordPayment already uses -- then
 *      persist the PaymentTransaction. THIS is the actual enforcement point
 *      against two concurrent initiations both succeeding.
 *
 * Known tradeoff (documented in Handsoff.md): if two requests race, both may
 * reach step 2 and both create a real Razorpay order before step 3 decides a
 * winner -- the loser's order is simply never persisted/returned and sits
 * unused at Razorpay (no money moves on order creation, so this costs
 * nothing but a wasted API call). What step 3 guarantees is that at most one
 * PaymentTransaction per invoice is ever active at a time.
 */
export async function initiatePayment(actingUser, invoiceId, input) {
  // --- Step 1: optimistic pre-check ----------------------------------------
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: INVOICE_SELECT });
  assertInvoiceEligibleForOnlinePayment(invoice);

  const totalAmount = round2(Number(invoice.totalAmount));
  const { remainingBefore: outstandingAtQuoteTime } = await computeInvoiceOutstanding(invoiceId, totalAmount);

  if (outstandingAtQuoteTime <= 0) {
    throw new AppError(409, `Invoice ${invoice.invoiceNumber} has no outstanding balance.`);
  }

  const existingActive = await prisma.paymentTransaction.findFirst({
    where: { invoiceId, status: { in: ACTIVE_TRANSACTION_STATUSES } },
    select: { id: true, status: true },
  });
  if (existingActive) {
    throw new AppError(
      409,
      `Invoice ${invoice.invoiceNumber} already has an active online payment in progress ` +
        `(status ${existingActive.status}). Wait for it to complete or fail before starting another.`
    );
  }

  // --- Step 2: create the Razorpay order (no DB lock held here) -----------
  let order;
  try {
    order = await createOrder({
      amount: outstandingAtQuoteTime,
      currency: invoice.currency,
      receipt: buildReceipt(invoiceId),
      notes: {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        ...(input?.notes ? { note: input.notes } : {}),
      },
    });
  } catch (err) {
    throw mapRazorpayError(err, { invoiceId });
  }

  // --- Step 3: lock, re-validate, persist ----------------------------------
  try {
    const paymentTransaction = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;

      const freshInvoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: INVOICE_SELECT });
      assertInvoiceEligibleForOnlinePayment(freshInvoice);

      const freshTotalAmount = round2(Number(freshInvoice.totalAmount));
      const { remainingBefore: freshOutstanding } = await computeInvoiceOutstanding(invoiceId, freshTotalAmount, tx);

      // The order was already created for `outstandingAtQuoteTime`; if the
      // true outstanding has since moved (a manual payment was recorded, or
      // another gateway payment was verified, while we were talking to
      // Razorpay), that order no longer matches the invoice and must not be
      // persisted as if it still did.
      if (freshOutstanding !== outstandingAtQuoteTime) {
        throw new AppError(
          409,
          `The outstanding balance on invoice ${invoice.invoiceNumber} changed while the payment order was being ` +
            `created (quoted ${outstandingAtQuoteTime}, now ${freshOutstanding}). Retry to get a fresh quote.`
        );
      }

      const stillNoActive = await tx.paymentTransaction.findFirst({
        where: { invoiceId, status: { in: ACTIVE_TRANSACTION_STATUSES } },
        select: { id: true },
      });
      if (stillNoActive) {
        throw new AppError(
          409,
          `Invoice ${invoice.invoiceNumber} already has an active online payment in progress. ` +
            "Wait for it to complete or fail before starting another."
        );
      }

      const createdRow = await tx.paymentTransaction.create({
        data: {
          invoiceId,
          provider: RAZORPAY_PROVIDER,
          gatewayOrderId: order.gatewayOrderId,
          amount: order.amount,
          currency: order.currency,
          status: "PENDING",
          initiatedById: actingUser.id,
          metadata: input?.notes ? { note: input.notes } : undefined,
        },
      });

      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: createdRow.id,
          action: "CREATE",
          performedById: actingUser.id,
          newValue: {
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            provider: createdRow.provider,
            gatewayOrderId: createdRow.gatewayOrderId,
            amount: round2(Number(createdRow.amount)),
            currency: createdRow.currency,
            status: createdRow.status,
          },
          note: "Online payment initiated (Razorpay order created).",
        },
        tx
      );

      return createdRow;
    });

    return {
      paymentTransactionId: paymentTransaction.id,
      gatewayOrderId: paymentTransaction.gatewayOrderId,
      provider: paymentTransaction.provider,
      amount: round2(Number(paymentTransaction.amount)),
      currency: paymentTransaction.currency,
      status: paymentTransaction.status,
      // Public key only -- never the secret. The frontend Checkout flow (a
      // later stage) needs this to open Razorpay's widget.
      keyId: env.razorpay.keyId,
    };
  } catch (err) {
    // The Razorpay order now exists (step 2 succeeded) but could not be
    // recorded. No money has moved -- this is an order, not a captured
    // payment -- so Stage 5 deliberately does not attempt compensating/
    // refund logic (Section 9). A controlled AppError from the re-validation
    // above is re-thrown as-is; anything else (a raw DB failure) is wrapped
    // so the caller never sees internal detail or a false "success".
    if (err instanceof AppError) throw err;
    // eslint-disable-next-line no-console
    console.error("[payments] Failed to persist PaymentTransaction after Razorpay order creation", {
      invoiceId,
      gatewayOrderId: order.gatewayOrderId,
    });
    throw new AppError(500, "The payment order was created but could not be recorded. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Stage 6: payment verification + finalization
// ---------------------------------------------------------------------------

const INVOICE_LOCK_SELECT = { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true };

/** Never forwards raw crypto/provider detail to the caller -- Section 3/6/19. */
function mapSignatureError(err, { gatewayOrderId }) {
  if (!(err instanceof RazorpayError)) {
    // eslint-disable-next-line no-console
    console.error("[payments] Unexpected error verifying payment signature", { gatewayOrderId });
    return new AppError(400, "Payment verification failed.");
  }

  // eslint-disable-next-line no-console
  console.error("[payments] Payment signature verification failed", { gatewayOrderId, code: err.code });

  switch (err.code) {
    case RAZORPAY_ERROR_CODES.CONFIG_MISSING:
      return new AppError(500, "Online payments are not configured. Contact an administrator.");
    case RAZORPAY_ERROR_CODES.INVALID_INPUT:
      return new AppError(400, "Invalid payment verification request.");
    case RAZORPAY_ERROR_CODES.INVALID_PAYMENT_SIGNATURE:
    default:
      return new AppError(400, "Payment signature verification failed.");
  }
}

/**
 * Terminal/idempotent-state handling for a PaymentTransaction, shared by the
 * cheap pre-lock check (avoids taking the invoice lock for a request that's
 * already resolved) and the re-check made again immediately after the lock
 * is acquired (closes the race where a concurrent request verifies the SAME
 * transaction in between -- Stage 6 Section 17).
 *
 * Returns `true` when the transaction is already VERIFIED with a matching
 * (or not-yet-recorded) gatewayPaymentId -- safe to resolve idempotently.
 * Returns `false` when the transaction is PENDING and settlement should
 * proceed. Throws a controlled AppError for every other case (FAILED,
 * CANCELLED, an already-VERIFIED transaction with a DIFFERENT
 * gatewayPaymentId, or any unexpected status).
 */
function isIdempotentReplay(transaction, gatewayPaymentId) {
  if (transaction.status === "VERIFIED") {
    if (transaction.gatewayPaymentId && transaction.gatewayPaymentId !== gatewayPaymentId) {
      throw new AppError(409, "This payment order was already verified with a different gateway payment id.");
    }
    return true;
  }
  if (transaction.status === "FAILED") {
    throw new AppError(409, "This payment attempt already failed and cannot be verified.");
  }
  if (transaction.status === "CANCELLED") {
    throw new AppError(409, "This payment attempt was cancelled and cannot be verified.");
  }
  if (transaction.status !== "PENDING") {
    // CREATED is never persisted by this codebase's initiation flow (Stage
    // 5), but this is guarded defensively rather than assumed.
    throw new AppError(
      409,
      `This payment transaction is in an unexpected state (${transaction.status}) and cannot be verified.`
    );
  }
  return false;
}

function buildVerifyResponse(transaction, clientPayment) {
  return {
    paymentTransactionId: transaction.id,
    clientPaymentId: clientPayment.id,
    gatewayOrderId: transaction.gatewayOrderId,
    gatewayPaymentId: transaction.gatewayPaymentId,
    invoiceId: transaction.invoiceId,
    amount: round2(Number(transaction.amount)),
    currency: transaction.currency,
    paymentTransactionStatus: transaction.status,
  };
}

/** Prisma P2002 (unique constraint) specifically on ClientPayment.paymentTransactionId. */
function isDuplicateClientPaymentError(err) {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  if (Array.isArray(target)) return target.includes("paymentTransactionId");
  return typeof target === "string" && target.includes("paymentTransactionId");
}

/**
 * THE single settlement algorithm (Stage 6 Section 8; extracted for reuse in
 * Stage 7 Section 12). Trusts that the caller has ALREADY established the
 * payment is genuine -- Stage 6's `verifyPayment` does this via a verified
 * payment signature; Stage 7's webhook handler does this via a verified
 * webhook signature plus a matched amount/currency (see
 * payment.webhook.service.js). This function itself performs NO signature
 * verification and trusts no client-supplied amount -- it only takes gateway
 * identifiers (to locate the already-created PaymentTransaction, whose own
 * stored `amount` is what actually gets applied) and who to attribute the
 * resulting audit trail to.
 *
 * Sequence:
 *   1. Locate the PaymentTransaction purely from the gateway order id --
 *      never from a client-supplied invoiceId (Stage 6 Section 4).
 *   2. Handle terminal/idempotent states before taking any lock. A repeat of
 *      an already-verified request is normal traffic (a frontend retry, or
 *      Stage 7's webhook arriving after /verify already settled it, or vice
 *      versa), not an error -- resolving it here costs nothing.
 *   3. Only a PENDING transaction reaches the locked settlement step: lock
 *      the invoice row (`SELECT ... FOR UPDATE`, the exact same lock
 *      recordPayment's manual path also takes -- see invoice.service.js),
 *      re-check the transaction's state AGAIN under the lock (closes the
 *      TOCTOU gap between step 2 and acquiring the lock -- this is also
 *      exactly how a webhook delivery and a /verify call, or two webhook
 *      deliveries, safely race each other), recompute the true current
 *      outstanding, compare it against the transaction's stored amount, then
 *      create the ClientPayment, mark the transaction VERIFIED, and derive
 *      the invoice status -- all in the one transaction, committed or
 *      rolled back together.
 *
 * @param {object} input
 * @param {string} input.actingUserId - Who the resulting audit trail is
 *   attributed to. Stage 6 passes the authenticated caller; Stage 7 (no
 *   authenticated user exists for a webhook) passes the transaction's own
 *   `initiatedById` -- the person who started this payment attempt is the
 *   natural actor for its own confirmation.
 * @param {string} input.gatewayOrderId
 * @param {string} input.gatewayPaymentId
 */
export async function finalizePaymentTransaction({ actingUserId, gatewayOrderId, gatewayPaymentId }) {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { provider_gatewayOrderId: { provider: RAZORPAY_PROVIDER, gatewayOrderId } },
  });
  if (!transaction) {
    throw new AppError(404, "No payment transaction found for this gateway order.");
  }

  // Cheap pre-lock check (step 2 above).
  if (isIdempotentReplay(transaction, gatewayPaymentId)) {
    const existingPayment = await prisma.clientPayment.findUnique({ where: { paymentTransactionId: transaction.id } });
    if (!existingPayment) {
      // Unreachable in normal operation -- VERIFIED is only ever set
      // alongside the ClientPayment that produced it, in the same
      // transaction (see below). Fail loudly rather than report success
      // with no payment to point to.
      throw new AppError(500, "Payment transaction is marked verified but its payment record is missing.");
    }
    return buildVerifyResponse(transaction, existingPayment);
  }

  let settled;
  try {
    settled = await prisma.$transaction(async (tx) => {
      // The serialization point (Stage 6 Section 8): this is the SAME lock
      // recordPayment's manual path takes, on the SAME row, so a manual
      // payment, a /payments/verify call, and a webhook delivery for the
      // same invoice can never all read a pre-payment balance and all
      // succeed.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${transaction.invoiceId} FOR UPDATE`;

      const freshTransaction = await tx.paymentTransaction.findUnique({ where: { id: transaction.id } });
      if (!freshTransaction) throw new AppError(404, "Payment transaction no longer exists.");

      // Re-check under the lock: a concurrent finalization of this exact
      // transaction (via /verify, a webhook, or another webhook delivery)
      // could have completed between the pre-lock check above and acquiring
      // this lock.
      if (isIdempotentReplay(freshTransaction, gatewayPaymentId)) {
        const existingPayment = await tx.clientPayment.findUnique({ where: { paymentTransactionId: freshTransaction.id } });
        if (!existingPayment) {
          throw new AppError(500, "Payment transaction is marked verified but its payment record is missing.");
        }
        return { transaction: freshTransaction, clientPayment: existingPayment };
      }

      const invoice = await tx.invoice.findUnique({ where: { id: freshTransaction.invoiceId }, select: INVOICE_LOCK_SELECT });
      if (!invoice) throw new AppError(404, "Invoice not found.");
      if (invoice.status === "CANCELLED") {
        throw new AppError(409, `Invoice ${invoice.invoiceNumber} has been cancelled and cannot accept a payment.`);
      }

      const totalAmount = round2(Number(invoice.totalAmount));
      const { remainingBefore: currentOutstanding } = await computeInvoiceOutstanding(invoice.id, totalAmount, tx);
      const transactionAmount = round2(Number(freshTransaction.amount));

      // The transaction's stored amount was fixed at initiation time (Stage
      // 5). If the TRUE outstanding has since dropped below it -- a manual
      // payment, another gateway payment, or a race winner via the other
      // finalization path already consumed part or all of the invoice while
      // this one was in flight -- applying it as-is would overpay. Equal or
      // greater is fine (equal pays it off; greater is a valid partial
      // payment).
      if (currentOutstanding < transactionAmount) {
        throw new AppError(
          409,
          `Invoice ${invoice.invoiceNumber}'s current outstanding balance (${currentOutstanding}) is less than this ` +
            `payment (${transactionAmount}) -- another payment already covered part or all of it. This gateway ` +
            "payment was received but could not be applied automatically; it needs manual reconciliation."
        );
      }

      const clientPayment = await tx.clientPayment.create({
        data: {
          invoiceId: invoice.id,
          amount: transactionAmount,
          // Server time, not client-suppliable -- there is no paymentDate
          // field anywhere a caller of this function can influence.
          paymentDate: new Date(),
          method: CLIENT_PAYMENT_METHOD,
          referenceNo: gatewayPaymentId,
          note: `Razorpay order ${gatewayOrderId}`,
          paymentTransactionId: freshTransaction.id,
        },
      });

      const updatedTransaction = await tx.paymentTransaction.update({
        where: { id: freshTransaction.id },
        // VERIFIED (and gatewayPaymentId persisted) only now, AFTER
        // ClientPayment creation succeeded -- never before.
        data: { status: "VERIFIED", gatewayPaymentId },
      });

      // Reuses the exact same PAID/PARTIALLY_PAID derivation recordPayment
      // uses -- no separate algorithm. remainingAfter is computed from the
      // real post-insert ClientPayment balance (currentOutstanding, which
      // already IS the true pre-payment sum, minus what was just added),
      // never from "the transaction is VERIFIED".
      const remainingAfter = round2(currentOutstanding - transactionAmount);
      await applyPaymentStatus(tx, {
        invoice,
        actingUser: { id: actingUserId },
        remainingAfter,
        comment:
          `Online payment of ${transactionAmount} ${invoice.currency} verified via Razorpay ` +
          `(order ${gatewayOrderId}, payment ${gatewayPaymentId}).`,
      });

      // Two audit rows -- identifying actor, invoice, PaymentTransaction,
      // ClientPayment, and gateway identifiers -- one against each entity
      // that actually changed, same convention recordPayment uses for its
      // own single-entity case. Never logs the signature.
      await writeAuditLog(
        {
          entityType: CLIENT_PAYMENT_ENTITY_TYPE,
          entityId: clientPayment.id,
          action: "CREATE",
          performedById: actingUserId,
          newValue: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: transactionAmount,
            method: CLIENT_PAYMENT_METHOD,
            paymentTransactionId: updatedTransaction.id,
            provider: updatedTransaction.provider,
            gatewayOrderId: updatedTransaction.gatewayOrderId,
            gatewayPaymentId: updatedTransaction.gatewayPaymentId,
            remainingAmount: remainingAfter,
          },
          note: "Online payment verified and recorded (Razorpay).",
        },
        tx
      );
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: updatedTransaction.id,
          action: "UPDATE",
          performedById: actingUserId,
          previousValue: { status: freshTransaction.status, gatewayPaymentId: freshTransaction.gatewayPaymentId },
          newValue: { status: updatedTransaction.status, gatewayPaymentId: updatedTransaction.gatewayPaymentId },
          note: `Verified against ClientPayment ${clientPayment.id}.`,
        },
        tx
      );

      return { transaction: updatedTransaction, clientPayment };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (isDuplicateClientPaymentError(err)) {
      // Defense-in-depth (Stage 6 Section 11): the invoice-row lock above
      // should make this unreachable, but if a ClientPayment for this exact
      // PaymentTransaction was somehow created by a concurrent path anyway,
      // resolve it the same way any other idempotent repeat is resolved,
      // rather than surfacing a raw integrity error as a 500.
      const existingPayment = await prisma.clientPayment.findUnique({ where: { paymentTransactionId: transaction.id } });
      const refreshedTransaction = await prisma.paymentTransaction.findUnique({ where: { id: transaction.id } });
      if (existingPayment && refreshedTransaction) {
        return buildVerifyResponse(refreshedTransaction, existingPayment);
      }
    }

    // eslint-disable-next-line no-console
    console.error("[payments] Failed to finalize payment transaction", {
      gatewayOrderId,
      gatewayPaymentId,
      paymentTransactionId: transaction.id,
    });
    throw new AppError(500, "Payment finalization could not be completed. Please try again or contact support.");
  }

  return buildVerifyResponse(settled.transaction, settled.clientPayment);
}

/**
 * Stage 6 entry point: verify a payment signature, then delegate to the
 * shared finalizer. See finalizePaymentTransaction's own doc comment for the
 * settlement algorithm itself -- this function's only job is establishing
 * that the request is genuine before that runs.
 */
export async function verifyPayment(actingUser, input) {
  const { gatewayOrderId, gatewayPaymentId, signature } = input;

  try {
    verifyPaymentSignature({ gatewayOrderId, gatewayPaymentId, signature });
  } catch (err) {
    throw mapSignatureError(err, { gatewayOrderId });
  }

  return finalizePaymentTransaction({ actingUserId: actingUser.id, gatewayOrderId, gatewayPaymentId });
}

// ---------------------------------------------------------------------------
// Stage 10: refund initiation
// ---------------------------------------------------------------------------

const REFUND_ENTITY_TYPE = "PaymentRefund";

// PaymentRefundStatus values that represent money genuinely reserved/moved
// against a ClientPayment -- excluded: REQUESTED (per Stage 8 decision,
// REQUESTED does not reserve the refundable balance) and the terminal
// FAILED/CANCELLED (nothing happened). This is the ONLY definition of
// "already refunded" used anywhere in this module -- never recomputed a
// second way.
const RESERVED_REFUND_STATUSES = ["PROCESSING", "PROCESSED"];

const CLIENT_PAYMENT_REFUND_SELECT = {
  id: true,
  invoiceId: true,
  amount: true,
  paymentTransactionId: true,
  paymentTransaction: {
    select: { id: true, provider: true, status: true, gatewayPaymentId: true, currency: true },
  },
};

/** Sum of PaymentRefund.amount rows already reserving balance against a ClientPayment. */
function sumReservedRefunds(refunds) {
  return round2(refunds.reduce((sum, r) => sum + Number(r.amount), 0));
}

/**
 * Section "ELIGIBILITY": a refund may only be initiated for a ClientPayment
 * that exists, is linked to a Razorpay PaymentTransaction, and has a real
 * gatewayPaymentId. A ClientPayment produced by the manual recordPayment
 * flow (paymentTransactionId null) has nothing for this codebase to submit
 * to Razorpay, so it is explicitly out of scope here -- not a gap, a
 * boundary (Stage 8 design, invariant #3).
 */
function assertRefundEligible(clientPayment) {
  if (!clientPayment) throw new AppError(404, "Client payment not found.");

  const transaction = clientPayment.paymentTransaction;
  if (!clientPayment.paymentTransactionId || !transaction) {
    throw new AppError(
      409,
      "This payment was recorded manually and has no linked gateway transaction; it cannot be refunded through Razorpay."
    );
  }
  if (transaction.provider !== RAZORPAY_PROVIDER) {
    throw new AppError(409, `Refunds are only supported for Razorpay payments; this payment used provider ${transaction.provider}.`);
  }
  if (!transaction.gatewayPaymentId) {
    throw new AppError(409, "This payment's Razorpay payment id is missing; it cannot be refunded.");
  }
  // Defensive, should be unreachable: a ClientPayment only ever exists once
  // its PaymentTransaction is VERIFIED (Stage 6 invariant) -- checked again
  // here rather than assumed, same discipline finalizePaymentTransaction
  // itself uses for its own preconditions.
  if (transaction.status !== "VERIFIED") {
    throw new AppError(409, "The underlying payment transaction is not in a verified state and cannot be refunded.");
  }
}

/** Section "REQUEST API": currency, if supplied, must match the original payment's -- never trusted to override it. */
function assertRefundCurrencyMatches(transaction, requestedCurrency) {
  if (!requestedCurrency) return;
  if (requestedCurrency.toUpperCase() !== String(transaction.currency || "").toUpperCase()) {
    throw new AppError(409, `Refund currency must match the original payment's currency (${transaction.currency}).`);
  }
}

function buildRefundResponse(refund, extra = {}) {
  return {
    id: refund.id,
    clientPaymentId: refund.clientPaymentId,
    status: refund.status,
    amount: round2(Number(refund.amount)),
    currency: refund.currency,
    gatewayRefundId: refund.gatewayRefundId,
    failureReason: refund.failureReason,
    createdAt: refund.createdAt,
    ...extra,
  };
}

/** Never forwards raw SDK/provider detail -- same discipline as mapRazorpayError/mapSignatureError. */
function sanitizeRefundFailureReason(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    return "Razorpay rejected the refund request.";
  }
  return message.trim().slice(0, 300);
}

/**
 * Deterministic-failure path (Section "RAZORPAY SUBMISSION"): the refund was
 * claimed (PROCESSING, no gatewayRefundId -- see claimRefundForSubmission)
 * but Razorpay definitively rejected it, so it is safely marked FAILED. Uses
 * a conditional `updateMany` guarded on the row still being the claimed
 * PROCESSING/no-id state -- same defense-in-depth pattern Stage 7's
 * `handleFailed` uses -- so this can never downgrade a row a concurrent
 * process has already moved on from.
 */
async function markRefundFailed(refund, actingUser, failureReason) {
  const updateResult = await prisma.paymentRefund.updateMany({
    where: { id: refund.id, status: "PROCESSING", gatewayRefundId: null },
    data: { status: "FAILED", failureReason },
  });
  const updated = await prisma.paymentRefund.findUnique({ where: { id: refund.id } });

  if (updateResult.count > 0) {
    await writeAuditLog({
      entityType: REFUND_ENTITY_TYPE,
      entityId: refund.id,
      action: "UPDATE",
      performedById: actingUser.id,
      previousValue: { status: "PROCESSING (claimed)" },
      newValue: { status: "FAILED", failureReason },
      note: "Razorpay rejected the refund submission; no refund was created.",
    });
  }

  return buildRefundResponse(updated);
}

/**
 * Submission-succeeded path: Razorpay ACCEPTED the refund (a gatewayRefundId
 * now exists) -- the row was already claimed into PROCESSING by
 * claimRefundForSubmission; this just fills in the gatewayRefundId, it never
 * moves to PROCESSED. Final confirmation is the refund.processed webhook, a
 * later stage (Section "SUCCESS behavior" of the Stage 10 brief is explicit
 * that this function must not claim PROCESSED).
 */
async function markRefundSubmitted(refund, actingUser, gatewayResult) {
  const updateResult = await prisma.paymentRefund.updateMany({
    where: { id: refund.id, status: "PROCESSING", gatewayRefundId: null },
    data: {
      gatewayRefundId: gatewayResult.gatewayRefundId,
      failureReason: null,
    },
  });
  const updated = await prisma.paymentRefund.findUnique({ where: { id: refund.id } });

  if (updateResult.count > 0) {
    await writeAuditLog({
      entityType: REFUND_ENTITY_TYPE,
      entityId: refund.id,
      action: "UPDATE",
      performedById: actingUser.id,
      previousValue: { status: "PROCESSING (claimed)", gatewayRefundId: null },
      newValue: { status: "PROCESSING", gatewayRefundId: updated.gatewayRefundId },
      note: "Refund accepted by Razorpay; awaiting final confirmation via webhook.",
    });
  }

  return buildRefundResponse(updated);
}

/**
 * Uncertain-outcome path (Stage 8's core rule, restated in the Stage 10
 * correction): a network/timeout failure with no HTTP response from Razorpay
 * at all means this process cannot tell whether the refund was created. The
 * claim (PROCESSING, no gatewayRefundId) is REVERSED back to REQUESTED --
 * NOT retried here, NOT marked FAILED, and never left resting as a bare
 * PROCESSING-with-no-id (that must never be a final/observable state). A
 * later reconciliation/webhook stage resolves it. The reverted REQUESTED row
 * is what blocks a second refund request/approval for the same ClientPayment
 * until that resolution happens.
 *
 * Stage 13 review fix: the revert can legitimately lose a race to the
 * refund's own webhook confirmation (Razorpay DID receive/process the
 * request -- only OUR response was lost -- and refund.processed/failed
 * arrives for this exact refund while this function is still running).
 * `revertClaimToRequested` correctly leaves an already-resolved row alone in
 * that case, but this function previously still unconditionally wrote a
 * "reverted to REQUESTED, pending reconciliation" audit entry and API
 * response -- a false statement about a refund that had, in fact, already
 * been confirmed PROCESSED/FAILED by the webhook. Fixed by checking whether
 * the revert actually applied and, if not, reporting the refund's real
 * current state instead of a stale assumption.
 */
async function markRefundSubmissionUncertain(refund, actingUser, err) {
  // eslint-disable-next-line no-console
  console.error("[payments] Refund submission outcome uncertain (no confirmed Razorpay response)", {
    paymentRefundId: refund.id,
    clientPaymentId: refund.clientPaymentId,
    code: err instanceof RazorpayError ? err.code : undefined,
  });

  const reverted = await revertClaimToRequested(refund.id);
  const current = await prisma.paymentRefund.findUnique({ where: { id: refund.id } });

  if (!reverted) {
    // Lost the race to a concurrent resolution (most likely this refund's
    // own webhook confirming the very submission whose HTTP response we
    // just failed to receive) -- the refund is already PROCESSED/FAILED.
    // Report its TRUE state; do not claim it is "reverted"/"pending".
    // eslint-disable-next-line no-console
    console.error("[payments] Refund was already resolved by a concurrent process before the revert could apply", {
      paymentRefundId: refund.id,
      resolvedStatus: current.status,
    });
    return buildRefundResponse(current);
  }

  await writeAuditLog({
    entityType: REFUND_ENTITY_TYPE,
    entityId: refund.id,
    action: "UPDATE",
    performedById: actingUser.id,
    previousValue: { status: "PROCESSING (claimed)" },
    newValue: { status: "REQUESTED (submission outcome unknown, claim reverted)" },
    note:
      "Razorpay refund submission outcome could not be confirmed (network/timeout, no response received); " +
      "reverted to REQUESTED for reconciliation. Not retried automatically.",
  });

  return buildRefundResponse(current, {
    reconciliationPending: true,
    message:
      "The refund submission was attempted, but Razorpay's response could not be confirmed. This refund is back " +
      "in REQUESTED state, pending reconciliation, and has NOT been retried automatically.",
  });
}

/** Maps a createRefund() failure onto the correct outcome path -- never guesses. */
async function handleRefundSubmissionFailure(refund, actingUser, err) {
  if (!(err instanceof RazorpayError)) {
    // eslint-disable-next-line no-console
    console.error("[payments] Unexpected error submitting refund to Razorpay", { paymentRefundId: refund.id });
    // An unexpected (non-provider) error is not proof the request never
    // reached Razorpay -- treated as uncertain, never as a deterministic
    // failure, per Stage 8/10's own rule.
    return markRefundSubmissionUncertain(refund, actingUser, err);
  }

  switch (err.code) {
    case RAZORPAY_ERROR_CODES.CONFIG_MISSING:
      // Nothing was ever sent to Razorpay -- the client was never even
      // constructed, so this is safely deterministic.
      return markRefundFailed(refund, actingUser, "Online refunds are not configured. Contact an administrator.");
    case RAZORPAY_ERROR_CODES.INVALID_INPUT:
    case RAZORPAY_ERROR_CODES.UNSUPPORTED_CURRENCY:
      // Rejected by this codebase's own validation before any HTTP call was
      // attempted -- also safely deterministic.
      return markRefundFailed(refund, actingUser, sanitizeRefundFailureReason(err.message));
    case RAZORPAY_ERROR_CODES.REFUND_API_ERROR:
      // Razorpay itself responded with a rejection -- definitively failed
      // before any refund was created.
      return markRefundFailed(refund, actingUser, sanitizeRefundFailureReason(err.message));
    case RAZORPAY_ERROR_CODES.REFUND_UNCERTAIN:
    default:
      // No confirmed response reached this process -- outcome unknown.
      return markRefundSubmissionUncertain(refund, actingUser, err);
  }
}

/**
 * Initiates a refund against a confirmed, gateway-originated ClientPayment
 * (Payment Gateway Stage 10, Stage 8 design).
 *
 * Stage 10 correction: this function ONLY performs initiation (Section
 * "INITIATE ENDPOINT AFTER CORRECTION" -- validate, authorize, lock, compute
 * refundable balance, create PaymentRefund REQUESTED, audit, return). It
 * MUST NOT call Razorpay, set gatewayRefundId, or move the row to
 * PROCESSING/FAILED -- there is no Razorpay network dependency in this
 * function at all. Submission to Razorpay is a separate, maker-checker-gated
 * step (see approveRefund below), authorized by a different permission
 * (APPROVE_REFUND) and, per the maker-checker rule, a different user.
 *
 * Sequence:
 *   Locked DB transaction: lock the ClientPayment row, re-validate
 *   eligibility, compute the refundable balance, create the PaymentRefund as
 *   REQUESTED, audit, commit. That's it -- initiation stops there.
 *
 * Idempotency/concurrency (Section "IDEMPOTENCY / DUPLICATE REQUESTS" and
 * "DATABASE CONCURRENCY"): the ClientPayment row lock serializes concurrent
 * initiation attempts on the same payment; the first to commit its REQUESTED
 * row makes every other concurrent (or later) attempt see that row via the
 * `existingUnresolved` check below and be rejected with a 409, rather than
 * racing on the refundable-balance math. (Duplicate-Razorpay-submission
 * protection is a separate concern, handled by approveRefund's atomic claim.)
 */
export async function initiateRefund(actingUser, clientPaymentId, input) {
  // Cheap pre-check (mirrors initiatePayment's own shape): fail fast on an
  // obviously-ineligible payment before ever taking the lock. NOT the
  // concurrency-safety boundary -- the locked re-validation below is.
  const preCheckPayment = await prisma.clientPayment.findUnique({
    where: { id: clientPaymentId },
    select: CLIENT_PAYMENT_REFUND_SELECT,
  });
  assertRefundEligible(preCheckPayment);
  assertRefundCurrencyMatches(preCheckPayment.paymentTransaction, input.currency);

  // --- Step A: lock, re-validate, persist REQUESTED --------------------
  const requested = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ClientPayment" WHERE id = ${clientPaymentId} FOR UPDATE`;

    const clientPayment = await tx.clientPayment.findUnique({
      where: { id: clientPaymentId },
      select: CLIENT_PAYMENT_REFUND_SELECT,
    });
    assertRefundEligible(clientPayment);
    assertRefundCurrencyMatches(clientPayment.paymentTransaction, input.currency);

    // An unresolved REQUESTED refund means a prior initiation's Razorpay
    // outcome is not yet known (or it genuinely never got submitted, which
    // this codebase cannot distinguish from "submitted but response lost"
    // purely from DB state) -- Stage 8/10 forbid creating a second refund
    // attempt in either case until that row is reconciled.
    const existingUnresolved = await tx.paymentRefund.findFirst({
      where: { clientPaymentId, status: "REQUESTED" },
      select: { id: true, amount: true, createdAt: true },
    });
    if (existingUnresolved) {
      throw new AppError(
        409,
        `An unresolved refund request (${existingUnresolved.id}, amount ${round2(Number(existingUnresolved.amount))}) ` +
          "already exists for this payment and its outcome with Razorpay is not yet confirmed. It must be " +
          "reconciled before a new refund can be initiated."
      );
    }

    const reservedRefunds = await tx.paymentRefund.findMany({
      where: { clientPaymentId, status: { in: RESERVED_REFUND_STATUSES } },
      select: { amount: true },
    });
    const totalReserved = sumReservedRefunds(reservedRefunds);
    const paymentAmount = round2(Number(clientPayment.amount));
    const refundableAmount = round2(paymentAmount - totalReserved);

    if (refundableAmount <= 0) {
      throw new AppError(409, `Client payment ${clientPaymentId} has already been fully refunded.`);
    }
    if (input.amount > refundableAmount) {
      throw new AppError(
        409,
        `Refund amount ${input.amount} exceeds the ${refundableAmount} still refundable on this payment ` +
          `(of ${paymentAmount} originally paid).`
      );
    }

    const refund = await tx.paymentRefund.create({
      data: {
        clientPaymentId,
        provider: RAZORPAY_PROVIDER,
        gatewayPaymentId: clientPayment.paymentTransaction.gatewayPaymentId,
        amount: input.amount,
        currency: clientPayment.paymentTransaction.currency,
        status: "REQUESTED",
        reason: input.reason ?? null,
        requestedById: actingUser.id,
      },
    });

    await writeAuditLog(
      {
        entityType: REFUND_ENTITY_TYPE,
        entityId: refund.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          clientPaymentId,
          amount: round2(Number(refund.amount)),
          currency: refund.currency,
          provider: refund.provider,
          gatewayPaymentId: refund.gatewayPaymentId,
          status: refund.status,
          reason: refund.reason,
          refundableBefore: refundableAmount,
        },
        note: "Refund requested (not yet submitted to Razorpay).",
      },
      tx
    );

    return refund;
  });

  // Stage 10 correction: initiation stops here. No Razorpay call is made in
  // this function -- submission is a separate, maker-checker-gated step
  // (see approveRefund below). The REQUESTED row itself is the durable
  // record of the maker's authorized request.
  return buildRefundResponse(requested);
}

// ---------------------------------------------------------------------------
// Stage 10 correction: refund approval / Razorpay submission (the "checker"
// step, gated on APPROVE_REFUND, deliberately separate from initiateRefund's
// INITIATE_REFUND). Split out because the approved Stage 8 design requires
// maker != checker -- the person who requested a refund may never be the one
// who authorizes its submission to Razorpay, mirroring the exact precedent
// already established for PayrollRun (APPROVE_PAYROLL vs MANAGE_SALARY) and
// vendor bills (creator != approver).
// ---------------------------------------------------------------------------

/**
 * Atomically claims a REQUESTED refund for submission by transitioning it to
 * PROCESSING via a conditional `updateMany` -- THIS is the concurrency
 * boundary, not a held transaction/lock across the Razorpay call (which is
 * explicitly forbidden). Postgres serializes concurrent UPDATEs against the
 * same row: if two checkers call approveRefund for the same refund at once,
 * only one `updateMany` can match `status = 'REQUESTED'` (the loser's WHERE
 * clause sees the winner's already-applied change and matches zero rows) --
 * so at most one caller ever proceeds to call Razorpay for a given refund.
 *
 * A PROCESSING row with no `gatewayRefundId` yet is this claim's transient
 * signature; it never persists as a final/observable state -- the caller
 * always follows up with exactly one of: fill in `gatewayRefundId` (success),
 * move to FAILED (deterministic rejection), or revert back to REQUESTED
 * (uncertain outcome -- see markRefundSubmissionUncertain). A bare
 * "PROCESSING with no gatewayRefundId" must never be the row's resting state.
 */
async function claimRefundForSubmission(refundId) {
  const claim = await prisma.paymentRefund.updateMany({
    where: { id: refundId, status: "REQUESTED" },
    data: { status: "PROCESSING" },
  });
  return claim.count > 0;
}

/**
 * Reverses a claim (PROCESSING, no gatewayRefundId) back to REQUESTED --
 * used only by the uncertain-outcome path, so the row never rests in
 * PROCESSING without a gatewayRefundId (Section "INITIATE ENDPOINT AFTER
 * CORRECTION" / "APPROVE_REFUND" item 11's explicit rule).
 *
 * Returns whether the revert actually applied. It can legitimately match
 * zero rows: the refund webhook (payment.webhook.service.js's
 * transitionRefund) can resolve this SAME refund to PROCESSED/FAILED
 * concurrently -- e.g. Razorpay's response to THIS call was merely lost in
 * transit, but the refund itself genuinely went through, and its
 * refund.processed webhook arrives while this function is still running.
 * The caller MUST check this before claiming/auditing a "reverted" outcome
 * (Stage 13 review fix -- see markRefundSubmissionUncertain).
 */
async function revertClaimToRequested(refundId) {
  const result = await prisma.paymentRefund.updateMany({
    where: { id: refundId, status: "PROCESSING", gatewayRefundId: null },
    data: { status: "REQUESTED" },
  });
  return result.count > 0;
}

/**
 * Approves and submits a REQUESTED refund to Razorpay (Stage 10 correction,
 * Section "APPROVAL ENDPOINT", followed exactly):
 *   1-5. Load, verify exists/REQUESTED/checker != maker.
 *   6-7. Re-derive the ClientPayment/PaymentTransaction and re-confirm
 *        eligibility (defensive -- guards against the underlying payment
 *        somehow becoming ineligible between initiation and approval).
 *   Claim: atomic REQUESTED -> PROCESSING (see claimRefundForSubmission).
 *   8-11. Call Razorpay outside any transaction; resolve the claimed row to
 *         PROCESSING+gatewayRefundId (success), FAILED (deterministic), or
 *         back to REQUESTED (uncertain) -- reusing the exact same outcome
 *         handlers initiateRefund used to use, now operating on the claimed
 *         PROCESSING row instead of REQUESTED.
 *   12. Every transition is audited.
 */
export async function approveRefund(actingUser, refundId) {
  const refund = await prisma.paymentRefund.findUnique({ where: { id: refundId } });
  if (!refund) throw new AppError(404, "Refund not found.");

  // Maker-checker (Stage 8 decision 15, restated in this correction): the
  // requester's own id is never accepted from the request -- it is the
  // refund's own persisted requestedById.
  if (refund.requestedById === actingUser.id) {
    throw new AppError(403, "The refund's requester cannot also approve/submit it (maker-checker).");
  }
  if (refund.status !== "REQUESTED") {
    throw new AppError(409, `This refund is ${refund.status} and cannot be approved/submitted.`);
  }

  // Re-confirm eligibility against the current state of the payment -- the
  // same check initiateRefund performs, defensive here since time has passed
  // since the refund was requested.
  const clientPayment = await prisma.clientPayment.findUnique({
    where: { id: refund.clientPaymentId },
    select: CLIENT_PAYMENT_REFUND_SELECT,
  });
  assertRefundEligible(clientPayment);

  const claimed = await claimRefundForSubmission(refundId);
  if (!claimed) {
    // Lost the race to another concurrent approval, or the refund moved on
    // (cancelled, etc.) between the check above and the claim attempt.
    const current = await prisma.paymentRefund.findUnique({ where: { id: refundId } });
    throw new AppError(
      409,
      `This refund is already ${current?.status ?? "no longer REQUESTED"} and cannot be submitted again.`
    );
  }

  const claimedRefund = await prisma.paymentRefund.findUnique({ where: { id: refundId } });

  await writeAuditLog({
    entityType: REFUND_ENTITY_TYPE,
    entityId: refundId,
    action: "UPDATE",
    performedById: actingUser.id,
    previousValue: { status: "REQUESTED" },
    newValue: { status: "PROCESSING (claimed; submitting to Razorpay)" },
    note: `Refund approved for submission (requested by ${refund.requestedById}, approved by ${actingUser.id}).`,
  });

  // Outside any transaction/lock -- the claim above is what makes this safe,
  // not a held DB lock across the call.
  let gatewayResult;
  try {
    gatewayResult = await createRefund({
      gatewayPaymentId: claimedRefund.gatewayPaymentId,
      amount: round2(Number(claimedRefund.amount)),
      currency: claimedRefund.currency,
      notes: claimedRefund.reason ? { reason: claimedRefund.reason } : undefined,
    });
  } catch (err) {
    return handleRefundSubmissionFailure(claimedRefund, actingUser, err);
  }

  return markRefundSubmitted(claimedRefund, actingUser, gatewayResult);
}
