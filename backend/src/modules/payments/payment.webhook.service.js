// Razorpay webhook processing (Payment Gateway Stage 7, extended Stage 11).
//
// Server-to-server payment notification path, independent of the frontend
// and of the synchronous /payments/verify endpoint (Stage 6). This is the
// ONLY module allowed to write PaymentGatewayEvent rows. It does NOT
// duplicate Stage 6's settlement algorithm -- successful captures are
// finalized through the exact same finalizePaymentTransaction() Stage 6's
// verifyPayment() calls, imported from payment.service.js, so there is one
// settlement algorithm, not two (Stage 7 Section 12).
//
// Trust boundary: nothing here is trusted until verifyWebhookSignature
// (Stage 4, unmodified) succeeds against the RAW request body. No JWT, no
// RECORD_CLIENT_PAYMENT permission -- Razorpay's signature IS the
// authentication for this endpoint (Stage 7 Section 1/20).
//
// Stage 11 scope: refund.processed/refund.failed, added to the SAME endpoint
// and event-recording machinery as payment.captured/payment.failed -- no
// second webhook route, no second event table, no change to the existing
// payment.* handling below. Resolves a PROCESSING refund (Stage 10's normal
// "approved, submitted, awaiting confirmation" state) to PROCESSED/FAILED,
// and separately reconciles a REQUESTED refund left behind by Stage 10's
// "submission outcome uncertain" case straight to PROCESSED/FAILED once
// Razorpay's own event arrives -- the exact mechanism Stage 8/10's design
// promised for resolving a lost-response refund. Never calls Razorpay
// (webhook processing only ever consumes an event, per Stage 11's explicit
// rule); never touches Invoice/ClientPayment (Model 1, unchanged).

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { verifyWebhookSignature } from "../../integrations/payment-gateway/razorpay/razorpay.service.js";
import {
  RazorpayError,
  RAZORPAY_ERROR_CODES,
  RAZORPAY_PROVIDER,
  INR_SMALLEST_UNIT_MULTIPLIER,
} from "../../integrations/payment-gateway/razorpay/razorpay.constants.js";
import { finalizePaymentTransaction } from "./payment.service.js";

const TRANSACTION_ENTITY_TYPE = "PaymentTransaction";
const REFUND_ENTITY_TYPE = "PaymentRefund";

// Stage 7 Section 6: only the event types the current MVP payment flow
// actually needs to act on. Everything else is validly-signed-but-unknown to
// this application -- recorded, safely acknowledged, no financial action.
const CAPTURED_EVENT_TYPE = "payment.captured";
const FAILED_EVENT_TYPE = "payment.failed";
// Stage 11: refund confirmation events, same "recorded, safely acknowledged
// if unsupported/unmatched" philosophy.
const REFUND_PROCESSED_EVENT_TYPE = "refund.processed";
const REFUND_FAILED_EVENT_TYPE = "refund.failed";
const SUPPORTED_EVENT_TYPES = new Set([
  CAPTURED_EVENT_TYPE,
  FAILED_EVENT_TYPE,
  REFUND_PROCESSED_EVENT_TYPE,
  REFUND_FAILED_EVENT_TYPE,
]);

// PaymentRefundStatus values a webhook may still resolve -- PROCESSED/FAILED/
// CANCELLED are terminal and are never revisited by a webhook (Stage 11's
// "do not downgrade PROCESSED, do not resurrect FAILED" rule).
const RESOLVABLE_REFUND_STATUSES = ["REQUESTED", "PROCESSING"];

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Never forwards raw crypto/provider detail -- Stage 7 Section 4/19/20. */
function mapWebhookSignatureError(err) {
  if (!(err instanceof RazorpayError)) {
    // eslint-disable-next-line no-console
    console.error("[payments] Unexpected error verifying webhook signature");
    return new AppError(400, "Webhook verification failed.");
  }

  // eslint-disable-next-line no-console
  console.error("[payments] Webhook signature verification failed", { code: err.code });

  switch (err.code) {
    case RAZORPAY_ERROR_CODES.CONFIG_MISSING:
      return new AppError(500, "Webhook processing is not configured.");
    case RAZORPAY_ERROR_CODES.INVALID_INPUT:
      return new AppError(400, "Malformed webhook request.");
    case RAZORPAY_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE:
    default:
      return new AppError(400, "Webhook signature verification failed.");
  }
}

/** Prisma P2002 (unique constraint) specifically on PaymentGatewayEvent's (provider, eventId). */
function isDuplicateEventError(err) {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  if (Array.isArray(target)) return target.includes("eventId");
  return typeof target === "string" && target.includes("eventId");
}

/**
 * Razorpay's documented idempotency mechanism for webhooks is the
 * `X-Razorpay-Event-Id` header -- used as the primary key here. If it is
 * ever absent, falls back to a key derived from fields the documented
 * `payload.event`/`payload.payment.entity.id` structure guarantees, so a
 * genuine redelivery of the SAME event still produces the SAME key even
 * without the header. This fallback is a defensive measure, not the
 * intended mechanism -- flagged in the Stage 7 report.
 */
function resolveEventId(headers, parsedBody) {
  const headerEventId = headers?.["x-razorpay-event-id"];
  if (typeof headerEventId === "string" && headerEventId.trim().length > 0) {
    return headerEventId.trim();
  }
  const paymentId = parsedBody?.payload?.payment?.entity?.id || "no-payment-id";
  return `fallback:${parsedBody?.event || "unknown"}:${paymentId}:${parsedBody?.created_at || ""}`;
}

/**
 * Atomically records a webhook delivery, or detects that this exact
 * (provider, eventId) was already recorded. The unique DB constraint is the
 * actual serialization point (Stage 7 Section 15) -- two concurrent
 * deliveries of the same eventId both attempt `create()`; Postgres allows
 * exactly one to succeed, and the loser is told so deterministically via a
 * P2002, never a race-prone "check then insert".
 */
async function recordEventOrDetectDuplicate({ eventId, eventType, payload }) {
  try {
    const event = await prisma.paymentGatewayEvent.create({
      data: { provider: RAZORPAY_PROVIDER, eventId, eventType, payload, signatureValid: true },
    });
    return { event, isNew: true };
  } catch (err) {
    if (isDuplicateEventError(err)) {
      const existing = await prisma.paymentGatewayEvent.findUnique({
        where: { provider_eventId: { provider: RAZORPAY_PROVIDER, eventId } },
      });
      if (existing) return { event: existing, isNew: false };
    }
    throw err;
  }
}

/**
 * `payment.captured`: validate the webhook's claimed amount/currency against
 * the stored PaymentTransaction (Stage 7 Section 9/10) BEFORE ever calling
 * the shared finalizer -- a mismatch is recorded and safely acknowledged,
 * never silently accepted and never finalized.
 */
async function handleCaptured(transaction, paymentEntity, gatewayOrderId, gatewayPaymentId) {
  // Razorpay amounts are in the smallest currency unit (paise for INR);
  // PaymentTransaction.amount is stored in rupees. Converted exactly once,
  // here, as the inverse of razorpay.service.js's own INR->paise conversion
  // (Stage 4) -- never re-derived a second way.
  const webhookAmount = round2(Number(paymentEntity.amount) / INR_SMALLEST_UNIT_MULTIPLIER);
  const webhookCurrency = String(paymentEntity.currency || "").toUpperCase();
  const transactionAmount = round2(Number(transaction.amount));
  const transactionCurrency = String(transaction.currency || "").toUpperCase();

  if (webhookAmount !== transactionAmount || webhookCurrency !== transactionCurrency) {
    // eslint-disable-next-line no-console
    console.error("[payments] Webhook payment.captured amount/currency mismatch", {
      gatewayOrderId,
      paymentTransactionId: transaction.id,
      classification: webhookAmount !== transactionAmount ? "AMOUNT_MISMATCH" : "CURRENCY_MISMATCH",
    });
    return; // recorded (the event row already exists), safely acknowledged, no financial mutation
  }

  try {
    await finalizePaymentTransaction({
      actingUserId: transaction.initiatedById,
      gatewayOrderId,
      gatewayPaymentId,
    });
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      // A business-rule conflict the shared finalizer itself detected
      // (already FAILED/CANCELLED, a different gatewayPaymentId on an
      // already-VERIFIED transaction, invoice cancelled, outstanding
      // already consumed by another payment, ...). Retrying the identical
      // webhook payload against an unchanged conflict would never resolve
      // it, so this is recorded and safely acknowledged, not treated as a
      // delivery failure worth Razorpay retrying (Stage 7 Section 16/17/21).
      // eslint-disable-next-line no-console
      console.error("[payments] Webhook payment.captured could not be applied", {
        gatewayOrderId,
        paymentTransactionId: transaction.id,
        status: err.status,
      });
      return;
    }
    throw err; // genuine/transient failure -- propagate so processedAt stays null and Razorpay retries
  }
}

/**
 * `payment.failed` (Stage 7 correction): a Razorpay ORDER can receive
 * several individual payment ATTEMPTS against it -- a customer's card can be
 * declined once and then succeed on retry, all against the SAME
 * gatewayOrderId / SAME PaymentTransaction. One attempt failing must
 * therefore NOT make the whole PaymentTransaction terminal: doing so would
 * make `isIdempotentReplay` reject a later, genuinely successful
 * `payment.captured` for that same order as "already failed" (Stage 6
 * Section 5/21's own terminal-state rule, applied correctly here means
 * PENDING stays PENDING until something actually settles it).
 *
 * So this handler:
 *   - NEVER changes `status` (stays PENDING; FAILED remains a valid enum
 *     value for a possible future terminal/reconciliation path, just not
 *     reachable from here)
 *   - NEVER writes `gatewayPaymentId` -- that field means "the payment that
 *     actually verified this transaction" (set only by
 *     finalizePaymentTransaction, only after a ClientPayment exists); a
 *     failed attempt is definitionally not that
 *   - records the attempt for visibility (support/reconciliation) in
 *     `metadata` and `failureReason`, both of which are otherwise unused
 *     while PENDING
 *   - never creates a ClientPayment, never touches the invoice, never calls
 *     finalizePaymentTransaction
 *
 * The conditional `updateMany` re-asserts `status = PENDING` at the database
 * level, so a transaction concurrently finalized by /verify or a
 * `payment.captured` delivery simply matches zero rows here rather than
 * racing it or overwriting its now-terminal state.
 */
async function handleFailed(transaction, gatewayPaymentId) {
  if (transaction.status !== "PENDING") return;

  const existingMetadata =
    transaction.metadata && typeof transaction.metadata === "object" && !Array.isArray(transaction.metadata)
      ? transaction.metadata
      : {};
  const failedAttempts = Array.isArray(existingMetadata.failedAttempts) ? existingMetadata.failedAttempts : [];
  // Small, bounded list of past attempts against this order -- not a queue,
  // just enough for support/reconciliation to see what happened before the
  // order eventually succeeded (or didn't).
  const updatedFailedAttempts = [...failedAttempts, { gatewayPaymentId, at: new Date().toISOString() }].slice(-10);

  const result = await prisma.paymentTransaction.updateMany({
    where: { id: transaction.id, status: "PENDING" },
    data: {
      metadata: { ...existingMetadata, failedAttempts: updatedFailedAttempts },
      failureReason: `Most recent failed attempt: gateway payment ${gatewayPaymentId} (transaction remains PENDING for retry).`,
    },
  });

  if (result.count > 0) {
    // No ClientPayment/invoice mutation happened, so this doesn't need the
    // invoice lock -- just its own audit trail, same as any other
    // PaymentTransaction change (Stage 7 Section 19). previousValue is
    // omitted: status did not change, there is nothing meaningful to diff.
    await writeAuditLog({
      entityType: TRANSACTION_ENTITY_TYPE,
      entityId: transaction.id,
      action: "UPDATE",
      performedById: transaction.initiatedById,
      newValue: { failedGatewayPaymentId: gatewayPaymentId, status: "PENDING (unchanged)" },
      note: "Razorpay reported payment.failed for one attempt against this order; PaymentTransaction stays PENDING so another attempt can still succeed.",
    });
  }
}

// ---------------------------------------------------------------------------
// Stage 11: refund.processed / refund.failed
// ---------------------------------------------------------------------------

/**
 * Locates the PaymentRefund a refund webhook event refers to.
 *
 * Primary: exact match on the unique (provider, gatewayRefundId) -- this is
 * how a Stage 10-confirmed PROCESSING refund (gatewayRefundId already
 * stored) is found; unambiguous by construction.
 *
 * Fallback (Stage 11's "REQUESTED RECONCILIATION"): when no row carries this
 * exact gatewayRefundId yet, search resolvable-status refunds against the
 * same gatewayPaymentId, narrowed by amount/currency where the webhook
 * supplies them -- amount is the real disambiguator, since one payment can
 * have several in-flight refunds of different amounts. Never guesses:
 *   - zero matches -> unknown refund (safe no-op, not an error)
 *   - exactly one match with NO gatewayRefundId on file -> the Stage
 *     10-uncertain refund this event is meant to reconcile
 *   - exactly one match that already carries a DIFFERENT gatewayRefundId ->
 *     a genuine data conflict (`conflict`), never resolved by guessing which
 *     id is "right"
 *   - more than one match -> ambiguous, cannot be safely resolved at all
 */
async function locateRefundForWebhook({ gatewayRefundId, gatewayPaymentId, webhookAmount, webhookCurrency }) {
  const primary = await prisma.paymentRefund.findUnique({
    where: { provider_gatewayRefundId: { provider: RAZORPAY_PROVIDER, gatewayRefundId } },
  });
  if (primary) return { refund: primary, conflict: null, ambiguous: false };

  const candidates = await prisma.paymentRefund.findMany({
    where: { provider: RAZORPAY_PROVIDER, gatewayPaymentId, status: { in: RESOLVABLE_REFUND_STATUSES } },
  });

  const matching = candidates.filter((c) => {
    if (webhookAmount != null && round2(Number(c.amount)) !== webhookAmount) return false;
    if (webhookCurrency && String(c.currency || "").toUpperCase() !== webhookCurrency) return false;
    return true;
  });

  if (matching.length === 0) return { refund: null, conflict: null, ambiguous: false };
  if (matching.length > 1) return { refund: null, conflict: null, ambiguous: true };

  const [candidate] = matching;
  if (candidate.gatewayRefundId && candidate.gatewayRefundId !== gatewayRefundId) {
    return { refund: null, conflict: candidate, ambiguous: false };
  }
  return { refund: candidate, conflict: null, ambiguous: false };
}

/**
 * Amount/currency/gatewayPaymentId consistency check against an already
 * safely-identified refund -- Stage 11's "do not silently accept a
 * mismatched refund amount" rule. Only checks fields the webhook actually
 * supplied (Razorpay's refund entity is not guaranteed to carry every field
 * on every event).
 */
function detectRefundInconsistency(refund, { gatewayPaymentId, webhookAmount, webhookCurrency }) {
  if (refund.gatewayPaymentId !== gatewayPaymentId) return "gatewayPaymentId mismatch";
  if (webhookAmount != null && round2(Number(refund.amount)) !== webhookAmount) return "amount mismatch";
  if (webhookCurrency && String(refund.currency || "").toUpperCase() !== webhookCurrency) return "currency mismatch";
  return null;
}

/**
 * The one transactional state-transition point for refund webhooks --
 * guarded by a conditional `updateMany` on `status IN (REQUESTED,
 * PROCESSING)`, the exact same defense-in-depth pattern `handleFailed` and
 * Stage 10's `claimRefundForSubmission`/outcome handlers already use: a
 * terminal row (PROCESSED/FAILED/CANCELLED), or one a concurrent process
 * (another webhook delivery, or a still-in-flight Stage 10 `approveRefund`
 * call) has already moved on from, simply matches zero rows here and is left
 * untouched -- never downgraded, never resurrected. Transactional so the
 * state change and its audit row commit or roll back together (Stage 11's
 * "do not update refund / fail audit / mark processed" ordering rule).
 */
async function transitionRefund(refund, { toStatus, gatewayRefundId, eventType, failureReason = null }) {
  return prisma.$transaction(async (tx) => {
    const updateResult = await tx.paymentRefund.updateMany({
      where: { id: refund.id, status: { in: RESOLVABLE_REFUND_STATUSES } },
      data: {
        status: toStatus,
        gatewayRefundId,
        failureReason: toStatus === "PROCESSED" ? null : failureReason,
      },
    });
    if (updateResult.count === 0) return null; // lost a race -- safe no-op, nothing left to do

    const updated = await tx.paymentRefund.findUnique({ where: { id: refund.id } });

    await writeAuditLog(
      {
        entityType: REFUND_ENTITY_TYPE,
        entityId: refund.id,
        action: "UPDATE",
        // No authenticated user exists for a webhook -- same convention
        // Stage 7 uses (transaction.initiatedById): attribute to the
        // refund's own requester.
        performedById: refund.requestedById,
        previousValue: { status: refund.status, gatewayRefundId: refund.gatewayRefundId },
        newValue: {
          status: updated.status,
          gatewayRefundId: updated.gatewayRefundId,
          failureReason: updated.failureReason,
        },
        note: `Razorpay webhook ${eventType} confirmed this refund's outcome.`,
      },
      tx
    );

    return updated;
  });
}

/**
 * `refund.processed`/`refund.failed` dispatch. Never calls Razorpay (Stage
 * 11's explicit rule -- webhook processing only consumes an event). Never
 * touches Invoice/ClientPayment (approved Model 1, unchanged).
 */
async function processRefundEvent(eventType, parsedBody) {
  const refundEntity = parsedBody?.payload?.refund?.entity;
  if (!refundEntity || typeof refundEntity.id !== "string" || typeof refundEntity.payment_id !== "string") {
    // Don't blindly trust arbitrary webhook JSON -- a refund.processed/
    // failed event MUST carry these fields; if it doesn't, there's nothing
    // safe to act on.
    return;
  }

  const gatewayRefundId = refundEntity.id;
  const gatewayPaymentId = refundEntity.payment_id;
  const webhookAmount = typeof refundEntity.amount === "number" ? round2(refundEntity.amount / INR_SMALLEST_UNIT_MULTIPLIER) : null;
  const webhookCurrency = typeof refundEntity.currency === "string" ? refundEntity.currency.toUpperCase() : null;

  const { refund, conflict, ambiguous } = await locateRefundForWebhook({
    gatewayRefundId,
    gatewayPaymentId,
    webhookAmount,
    webhookCurrency,
  });

  if (ambiguous) {
    // eslint-disable-next-line no-console
    console.error("[payments] Refund webhook could not be safely matched to exactly one PaymentRefund", {
      eventType,
      gatewayRefundId,
      gatewayPaymentId,
    });
    // Deliberately propagates: this event requires a financial-state
    // resolution that cannot be safely made, so processedAt must NOT be set
    // -- a later delivery/manual reconciliation may be able to resolve it.
    throw new AppError(
      409,
      "Refund webhook could not be safely reconciled to exactly one PaymentRefund; left unprocessed."
    );
  }

  if (conflict) {
    // eslint-disable-next-line no-console
    console.error("[payments] Refund webhook gatewayRefundId conflicts with an already-recorded id -- not mutated", {
      paymentRefundId: conflict.id,
      storedGatewayRefundId: conflict.gatewayRefundId,
      webhookGatewayRefundId: gatewayRefundId,
    });
    // Stage 11 correction: this is a financial-state conflict that cannot be
    // safely auto-resolved (same class of problem as the ambiguous-match
    // case above), so it must NOT be acknowledged as processed either --
    // propagate so processRazorpayWebhook leaves processedAt NULL and a
    // later Razorpay retry (or manual reconciliation) can attempt this
    // event again.
    throw new AppError(
      409,
      "Refund webhook's gatewayRefundId conflicts with an already-recorded id on this PaymentRefund; left unprocessed."
    );
  }

  if (!refund) {
    // An unknown refund -- safely acknowledge, never fabricate a financial
    // record for it (same discipline as the payment.* "unknown order" case).
    return;
  }

  if (!RESOLVABLE_REFUND_STATUSES.includes(refund.status)) {
    // Terminal (PROCESSED/FAILED/CANCELLED) -- preserved, no mutation. Covers
    // duplicate deliveries and out-of-order events against an already-final
    // refund.
    return;
  }

  const inconsistency = detectRefundInconsistency(refund, { gatewayPaymentId, webhookAmount, webhookCurrency });
  if (inconsistency) {
    // eslint-disable-next-line no-console
    console.error("[payments] Refund webhook data inconsistent with the matched PaymentRefund -- not mutated", {
      paymentRefundId: refund.id,
      eventType,
      reason: inconsistency,
    });
    return; // acknowledged, no mutation -- matches the payment.captured amount-mismatch precedent
  }

  if (eventType === REFUND_PROCESSED_EVENT_TYPE) {
    await transitionRefund(refund, { toStatus: "PROCESSED", gatewayRefundId, eventType });
    return;
  }

  await transitionRefund(refund, {
    toStatus: "FAILED",
    gatewayRefundId,
    eventType,
    failureReason: "Razorpay reported this refund as failed (webhook refund.failed).",
  });
}

/**
 * Dispatches a validly-signed, newly-recorded (or not-yet-processed) event
 * to the right handler. Unknown event types, and events missing the fields
 * Razorpay's documented structure guarantees, are safely no-ops (Stage 7
 * Section 6/7/8) -- there is nothing unsafe about acknowledging them.
 */
async function processEvent(eventType, parsedBody) {
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) return;

  if (eventType === REFUND_PROCESSED_EVENT_TYPE || eventType === REFUND_FAILED_EVENT_TYPE) {
    await processRefundEvent(eventType, parsedBody);
    return;
  }

  const paymentEntity = parsedBody?.payload?.payment?.entity;
  if (!paymentEntity || typeof paymentEntity.order_id !== "string" || typeof paymentEntity.id !== "string") {
    // Section 7: don't blindly trust arbitrary webhook JSON -- a
    // payment.captured/failed event MUST carry these fields; if it doesn't,
    // there's nothing safe to act on.
    return;
  }

  const gatewayOrderId = paymentEntity.order_id;
  const gatewayPaymentId = paymentEntity.id;

  // Section 8: locate PURELY by gatewayOrderId -- never trust an invoice id
  // even if the payload happened to carry one via `notes`.
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { provider_gatewayOrderId: { provider: RAZORPAY_PROVIDER, gatewayOrderId } },
  });
  if (!transaction) {
    // An order this application doesn't know about -- safely acknowledge,
    // never fabricate a financial record for it.
    return;
  }

  if (eventType === FAILED_EVENT_TYPE) {
    await handleFailed(transaction, gatewayPaymentId);
    return;
  }
  await handleCaptured(transaction, paymentEntity, gatewayOrderId, gatewayPaymentId);
}

/**
 * Entry point called by payment.webhook.controller.js with the RAW request
 * body (a Buffer, thanks to the route-scoped express.raw() in app.js -- see
 * that file's own comment) and the signature header, exactly as received.
 *
 * Ordering (Stage 7 Section 2/3/4):
 *   1. Verify the signature against the raw bytes BEFORE anything else --
 *      no PaymentGatewayEvent is written, nothing is parsed as trustworthy,
 *      until this succeeds.
 *   2. Only then JSON.parse the body.
 *   3. Record the event (or detect a duplicate delivery) -- the DB unique
 *      constraint on (provider, eventId) is the real safety net (Section
 *      15), not an in-memory check.
 *   4. If this exact event was already fully processed (`processedAt` set),
 *      stop -- pure no-op, nothing re-applied. If it was recorded but NOT
 *      yet processed (a genuine concurrent race, or a retry after an
 *      earlier transient failure -- Section 16), proceed to process it;
 *      this is safe even under a race because finalizePaymentTransaction is
 *      itself idempotent at the transaction level.
 *   5. Dispatch to the event-specific handler, then mark `processedAt`.
 *      Any transient/unexpected error propagates WITHOUT setting
 *      `processedAt`, so a genuine retry can still complete the work later
 *      (Section 16's explicit requirement); a business-rule conflict the
 *      handlers themselves recognize is instead recorded and acknowledged,
 *      since retrying identical data against an unchanged conflict would
 *      never help.
 */
export async function processRazorpayWebhook({ rawBody, signature, headers }) {
  if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0) || !signature) {
    throw new AppError(400, "Malformed webhook request.");
  }

  try {
    verifyWebhookSignature({ rawBody, signature });
  } catch (err) {
    throw mapWebhookSignatureError(err);
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Webhook payload is not valid JSON.");
  }

  const eventType = typeof parsedBody?.event === "string" ? parsedBody.event : "unknown";
  const eventId = resolveEventId(headers, parsedBody);

  const { event, isNew } = await recordEventOrDetectDuplicate({ eventId, eventType, payload: parsedBody });

  if (!isNew && event.processedAt) {
    // Already fully processed by an earlier delivery -- pure no-op.
    return { success: true };
  }

  try {
    await processEvent(eventType, parsedBody);
    await prisma.paymentGatewayEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[payments] Webhook event processing failed", { eventId, eventType });
    // The event row itself is already safely persisted (above); processedAt
    // stays null so a genuine retry can still complete the work.
    throw err instanceof AppError ? err : new AppError(500, "Webhook processing failed.");
  }

  return { success: true };
}
