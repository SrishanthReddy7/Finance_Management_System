// RazorpayX payout webhook processing (Payout Subsystem Step 3C).
//
// Mirrors payment.webhook.service.js's structure and discipline exactly,
// adapted for the payout (money-OUT) side:
//   - PayoutEvent (this file's exclusive write target) instead of
//     PaymentGatewayEvent
//   - Payout instead of PaymentTransaction
//   - applyTerminalOutcome (payout.service.js, now exported) instead of
//     finalizePaymentTransaction -- the SAME settlement algorithm /sync
//     already uses, never a second reimplementation
//   - recordPayoutReversal (payout.service.js, new in this step) for the
//     "already terminal, then reversed" case Step 3A.5 designed --
//     PaymentRefund's relationship to ClientPayment is the precedent this
//     mirrors, not anything invented fresh here
//
// Trust boundary: nothing here is trusted until verifyRazorpayXWebhookSignature
// (razorpayx.provider.js, Step 3C) succeeds against the RAW request body. No
// JWT, no permission check -- RazorpayX's own signature IS this endpoint's
// entire trust boundary (same rule Stage 7 established for the inbound
// webhook).
//
// Never calls RazorpayX (webhook processing only ever consumes an event,
// the same rule Stage 11 established for refund webhooks -- and the same
// reasoning payout-provider.interface.js's own header already gives for why
// getPayoutStatus/`/sync` are a FALLBACK, not the primary path: this
// endpoint is the primary path).
//
// Does NOT implement reconciliation, scheduled polling, or automated
// fund-account validation -- explicitly out of scope for this step.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { verifyRazorpayXWebhookSignature } from "../../integrations/payout-provider/razorpayx/razorpayx.provider.js";
import { sanitizeRazorpayXResponse, RAZORPAYX_PROVIDER } from "../../integrations/payout-provider/razorpayx/razorpayx.constants.js";
import { applyTerminalOutcome, recordPayoutReversal } from "./payout.service.js";

// Step 3A research: RazorpayX's documented payout webhook event names are
// payout.pending/payout.rejected/payout.queued/payout.initiated/
// payout.processed/payout.updated/payout.reversed/payout.failed/
// payout.downtime.started/payout.downtime.resolved. Only the ones that can
// actually move this system's PayoutStatus are acted on here -- everything
// else is safely acknowledged (event recorded, processedAt set) with no
// Payout mutation, same "unsupported event types are safe no-ops"
// philosophy the inbound webhook already established. There is no
// documented "payout.cancelled" webhook event, so none is invented here.
const PROCESSED_EVENT = "payout.processed";
const FAILED_EVENT = "payout.failed";
const REJECTED_EVENT = "payout.rejected";
const REVERSED_EVENT = "payout.reversed";
const SUPPORTED_EVENT_TYPES = new Set([PROCESSED_EVENT, FAILED_EVENT, REJECTED_EVENT, REVERSED_EVENT]);

// RazorpayX payout amounts are paise (Step 3A/3B-2 research); Payout.amount
// is stored in rupees. Same convention/multiplier the inbound side's
// INR_SMALLEST_UNIT_MULTIPLIER already uses -- RazorpayX payouts are
// INR-only (Step 3B-2's own enforcement), so this is not re-derived a
// second way for a currency this system doesn't support anyway.
const PAISE_PER_RUPEE = 100;
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Prisma P2002 (unique constraint) specifically on PayoutEvent's (provider, eventId). */
function isDuplicateEventError(err) {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  if (Array.isArray(target)) return target.includes("eventId");
  return typeof target === "string" && target.includes("eventId");
}

/**
 * Razorpay's documented idempotency mechanism for webhooks is the
 * `X-Razorpay-Event-Id` header -- used as the primary key here, same as the
 * inbound webhook. If it is ever absent, falls back to a key derived from
 * fields the documented `payload.event`/`payload.payout.entity.id`
 * structure guarantees, so a genuine redelivery of the SAME event still
 * produces the SAME key even without the header -- a defensive measure, not
 * the intended mechanism (same caveat the inbound webhook's own
 * resolveEventId already carries).
 */
function resolveEventId(headers, parsedBody) {
  const headerEventId = headers?.["x-razorpay-event-id"];
  if (typeof headerEventId === "string" && headerEventId.trim().length > 0) {
    return headerEventId.trim();
  }
  const payoutEntityId = parsedBody?.payload?.payout?.entity?.id || "no-payout-id";
  return `fallback:${parsedBody?.event || "unknown"}:${payoutEntityId}:${parsedBody?.created_at || ""}`;
}

/**
 * Atomically records a webhook delivery, or detects that this exact
 * (provider, eventId) was already recorded. The unique DB constraint is the
 * actual serialization point -- two concurrent deliveries of the same
 * eventId both attempt `create()`; Postgres allows exactly one to succeed,
 * the loser is told so deterministically via a P2002, never a race-prone
 * "check then insert" (same pattern the inbound webhook's own
 * recordEventOrDetectDuplicate uses for PaymentGatewayEvent).
 */
async function recordEventOrDetectDuplicate({ eventId, eventType, payload }) {
  try {
    const event = await prisma.payoutEvent.create({
      data: { provider: RAZORPAYX_PROVIDER, eventId, eventType, payload, signatureValid: true },
    });
    return { event, isNew: true };
  } catch (err) {
    if (isDuplicateEventError(err)) {
      const existing = await prisma.payoutEvent.findUnique({
        where: { provider_eventId: { provider: RAZORPAYX_PROVIDER, eventId } },
      });
      if (existing) return { event: existing, isNew: false };
    }
    throw err;
  }
}

/**
 * Dispatches a validly-signed, newly-recorded (or not-yet-processed) event
 * to the right handler. Unknown/unsupported event types, and events missing
 * the fields RazorpayX's documented structure guarantees, are safely
 * no-ops -- there is nothing unsafe about acknowledging them (same
 * philosophy the inbound webhook's own processEvent already established).
 */
async function processEvent(eventType, parsedBody) {
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) return;

  const payoutEntity = parsedBody?.payload?.payout?.entity;
  if (!payoutEntity || typeof payoutEntity.id !== "string") {
    // Don't blindly trust arbitrary webhook JSON -- these event types MUST
    // carry a payout entity with an id; if not, there's nothing safe to
    // act on.
    return;
  }

  // Locate PURELY by (provider, providerPayoutId) -- the exact compound
  // unique constraint Payout's own schema already defines. Never trust an
  // internal Payout id even if the payload happened to carry one via
  // `reference_id`/`notes` (same "don't trust anything from the payload for
  // lookup beyond the provider's own id" discipline the inbound webhook's
  // own Section 8 established for gatewayOrderId).
  const payout = await prisma.payout.findUnique({
    where: { provider_providerPayoutId: { provider: RAZORPAYX_PROVIDER, providerPayoutId: payoutEntity.id } },
  });
  if (!payout) {
    // A payout this application doesn't know about -- safely acknowledge,
    // never fabricate a financial record for it.
    return;
  }

  // No authenticated user exists for a webhook -- same convention Stage 7
  // uses (PaymentTransaction.initiatedById): attribute to the payout's own
  // maker.
  const actingUser = { id: payout.initiatedById };

  const sanitizedEntity = sanitizeRazorpayXResponse(payoutEntity);
  const webhookAmount = typeof payoutEntity.amount === "number" ? round2(payoutEntity.amount / PAISE_PER_RUPEE) : undefined;
  const utr = typeof payoutEntity.utr === "string" && payoutEntity.utr.length > 0 ? payoutEntity.utr : undefined;

  if (eventType === PROCESSED_EVENT || eventType === FAILED_EVENT) {
    // applyTerminalOutcome's OWN idempotency guard (already-terminal ->
    // alreadyTerminal:true, no mutation) is the single source of truth for
    // duplicate/out-of-order handling here -- not reimplemented locally.
    await applyTerminalOutcome(actingUser, payout.id, {
      targetStatus: eventType === PROCESSED_EVENT ? "PROCESSED" : "FAILED",
      utr,
      providerStatus: eventType === PROCESSED_EVENT ? "processed" : "failed",
      providerResponse: sanitizedEntity,
      failureReason: eventType === FAILED_EVENT ? "RazorpayX webhook reported this payout as failed." : undefined,
    });
    return;
  }

  if (eventType === REJECTED_EVENT) {
    // RazorpayX's own Approval Workflow rejection -- a DIFFERENT concept
    // from this system's own maker-checker PayoutStatus.REJECTED (which
    // only ever happens pre-submission). Maps defensively to FAILED, same
    // as syncPayoutStatus's own STATUS_MAP (Step 3B-2) -- should not occur
    // in practice if RazorpayX's Approval Workflow stays disabled on the
    // account (Step 3A's recommendation), but must not crash if it ever
    // does.
    await applyTerminalOutcome(actingUser, payout.id, {
      targetStatus: "FAILED",
      providerStatus: "rejected",
      providerResponse: sanitizedEntity,
      failureReason: "RazorpayX webhook reported this payout as rejected.",
    });
    return;
  }

  if (eventType === REVERSED_EVENT) {
    if (payout.status === "PROCESSING") {
      // First and only terminal outcome for this payout -- the EXISTING
      // applyTerminalOutcome PROCESSING->REVERSED path, completely
      // unchanged by Step 3C.
      await applyTerminalOutcome(actingUser, payout.id, {
        targetStatus: "REVERSED",
        utr,
        providerStatus: "reversed",
        providerResponse: sanitizedEntity,
      });
      return;
    }

    if (["PROCESSED", "FAILED"].includes(payout.status)) {
      // Already terminal -- Step 3A.5's design: record as a SEPARATE
      // PayoutReversal row, NEVER overwrite Payout.status. Idempotent on
      // its own (PayoutReversal.payoutId is @unique) -- a duplicate/
      // out-of-order delivery of this exact scenario is a safe no-op there.
      await recordPayoutReversal(actingUser, payout.id, {
        amount: webhookAmount,
        utr,
        reason: `RazorpayX webhook reported this payout as reversed after it had already reached ${payout.status}.`,
        providerResponse: sanitizedEntity,
      });
      return;
    }

    if (payout.status === "REVERSED") {
      // Already reversed via the direct PROCESSING->REVERSED path above --
      // a duplicate/out-of-order delivery of the SAME event. Safe no-op.
      return;
    }

    // Any other status (AWAITING_APPROVAL, APPROVED, QUEUED, CANCELLED,
    // REJECTED) -- a reversal is not a reachable outcome from any of these
    // in this system's own design; log for visibility, never mutate
    // blindly by guessing what should happen.
    // eslint-disable-next-line no-console
    console.error("[payouts] Webhook payout.reversed received for a payout in an unexpected status", {
      payoutId: payout.id,
      status: payout.status,
    });
    return;
  }
}

/**
 * Entry point called by payout.webhook.controller.js with the RAW request
 * body (a Buffer, thanks to a route-scoped raw-body parser in app.js -- see
 * that file's own comment, mirroring the inbound webhook's identical setup)
 * and the signature header, exactly as received.
 *
 * Ordering (mirrors payment.webhook.service.js's own processRazorpayWebhook
 * exactly):
 *   1. Verify the signature against the raw bytes BEFORE anything else --
 *      no PayoutEvent is written, nothing is parsed as trustworthy, until
 *      this succeeds.
 *   2. Only then JSON.parse the body.
 *   3. Record the event (or detect a duplicate delivery) -- the DB unique
 *      constraint on (provider, eventId) is the real safety net, not an
 *      in-memory check.
 *   4. If this exact event was already fully processed (`processedAt` set),
 *      stop -- pure no-op, nothing re-applied. If it was recorded but NOT
 *      yet processed (a genuine concurrent race, or a retry after an
 *      earlier transient failure), proceed to process it -- safe even under
 *      a race because applyTerminalOutcome/recordPayoutReversal are
 *      themselves idempotent.
 *   5. Dispatch to the event-specific handler, then mark `processedAt`. Any
 *      transient/unexpected error propagates WITHOUT setting `processedAt`,
 *      so a genuine retry can still complete the work later.
 */
export async function processRazorpayXWebhook({ rawBody, signature, headers }) {
  if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0) || !signature) {
    throw new AppError(400, "Malformed webhook request.");
  }

  try {
    verifyRazorpayXWebhookSignature({ rawBody, signature });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[payouts] Webhook signature verification failed", { message: err.message });
    throw new AppError(400, "Webhook signature verification failed.");
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Webhook payload is not valid JSON.");
  }

  const eventType = typeof parsedBody?.event === "string" ? parsedBody.event : "unknown";
  const eventId = resolveEventId(headers, parsedBody);

  // Sanitized independently of what's extracted for dispatch logic below --
  // this is what gets PERSISTED (Step 3C Section 8: never persist raw
  // beneficiary bank/VPA details unnecessarily). None of the fields
  // processEvent actually reads (id/status/amount/utr) are on the denylist,
  // so this has no effect on dispatch correctness.
  const sanitizedPayloadForStorage = sanitizeRazorpayXResponse(parsedBody);

  const { event, isNew } = await recordEventOrDetectDuplicate({ eventId, eventType, payload: sanitizedPayloadForStorage });

  if (!isNew && event.processedAt) {
    // Already fully processed by an earlier delivery -- pure no-op.
    return { success: true };
  }

  try {
    await processEvent(eventType, parsedBody);
    await prisma.payoutEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[payouts] Webhook event processing failed", { eventId, eventType });
    // The event row itself is already safely persisted (above); processedAt
    // stays null so a genuine retry can still complete the work.
    throw err instanceof AppError ? err : new AppError(500, "Webhook processing failed.");
  }

  return { success: true };
}
