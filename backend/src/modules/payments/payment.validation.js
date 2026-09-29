// Zod layer for the Payments module (Payment Gateway Stages 5-6).
//
// .strict() throughout, same convention as every other module -- an unknown
// key is a clean 400 rather than being silently dropped. This is what makes
// "the client must not supply amount/currency" an enforced rule rather than
// a comment: `amount`, `currency`, `invoiceTotal` and `paymentAmount` are not
// fields in this schema, so a request that includes any of them fails
// validation instead of those values ever reaching the service layer.

import { z } from "zod";
import { positiveMoney, currency } from "../../utils/zodMoney.js";

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

export const invoiceIdParamSchema = z.object({
  invoiceId: uuid("Invoice id"),
});

// Payment Gateway Stage 10 (Stage 8 design): clientPaymentId comes from the
// URL, never the body.
export const clientPaymentIdParamSchema = z.object({
  clientPaymentId: uuid("Client payment id"),
});

// Stage 10 correction: the approval/submission endpoint's only input --
// refundId from the URL. checkerId is never accepted from anywhere but
// req.user.id (maker-checker, Stage 8 decision 15), so there is no request
// body to validate here at all.
export const refundIdParamSchema = z.object({
  refundId: uuid("Refund id"),
});

// Stage 10, Section "REQUEST API": the only three fields a caller may supply.
// `gatewayPaymentId`, `provider`, and `requestedById` are deliberately absent
// -- the gateway payment id is derived server-side from the ClientPayment's
// own PaymentTransaction, provider is always RAZORPAY in this stage, and
// requestedById always comes from req.user.id, never the request body
// (same discipline verifyPaymentSchema already applies to amount/currency/
// invoiceId). `currency`, if supplied, is validated against the payment's
// own currency in the service layer rather than trusted -- it exists here
// only so a caller can be explicit/defensive, never to override anything.
export const initiateRefundSchema = z
  .object({
    amount: positiveMoney("Refund amount"),
    currency: currency.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// The only thing a caller may legitimately supply when initiating an online
// payment -- everything that decides the amount, currency, and eligibility
// is computed server-side from the invoice (Stage 5, Sections 3/6/7).
export const initiatePaymentSchema = z
  .object({
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// Stage 6 verification: the only three fields a caller may legitimately
// supply. `amount`, `currency` and `invoiceId` are deliberately absent --
// the amount/currency come from the stored PaymentTransaction, and the
// invoice is derived from that transaction, never from the request (Stage 6,
// Section 2). Lengths are generous but bounded: Razorpay order/payment ids
// are short opaque tokens, and a hex-encoded HMAC-SHA256 signature is fixed
// at 64 characters -- these caps just stop something absurd from reaching
// the service layer, not a real-world valid id/signature.
export const verifyPaymentSchema = z
  .object({
    gatewayOrderId: z.string().trim().min(1).max(255),
    gatewayPaymentId: z.string().trim().min(1).max(255),
    signature: z.string().trim().min(1).max(255),
  })
  .strict();
