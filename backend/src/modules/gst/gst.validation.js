// Zod schemas for the GST & Tax module (FRS Section 17).
//
// Dates go through the shared utils/zodDate `isoDate` and money through the
// shared utils/zodMoney helpers, so a GST figure is validated exactly as the
// invoice or bill figure it has to reconcile against.

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";
import { taxRate, DECIMAL_MAX } from "../../utils/zodMoney.js";

export const GST_DIRECTIONS = ["OUTPUT", "INPUT"];
export const GST_FILING_STATUSES = [
  "NOT_STARTED",
  "IN_PREPARATION",
  "READY",
  "FILED",
  "ACKNOWLEDGED",
];

/**
 * A GST amount on an adjustment entry, unlike one on an invoice, may be
 * NEGATIVE: reversing an over-stated output tax is the normal way to correct a
 * period once the row it came from is immutable. So this deliberately does not
 * reuse nonNegativeMoney -- it keeps that helper's 2-decimal and magnitude
 * rules and drops only the sign floor.
 */
const signedMoney = (label) =>
  z
    .number()
    .min(-DECIMAL_MAX, `${label} exceeds the maximum storable amount.`)
    .max(DECIMAL_MAX, `${label} exceeds the maximum storable amount.`)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
      message: `${label} must have at most 2 decimal places.`,
    });

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const listGstTransactionsQuerySchema = z.object({
  direction: z.enum(GST_DIRECTIONS).optional(),
  periodId: z.string().uuid("periodId must be a valid id.").optional(),
  // Accepts "2026-08" as well as the id, because that is how a human names a
  // tax period and how FRS Section 28 writes one.
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be in YYYY-MM form, e.g. 2026-08.")
    .optional(),
  invoiceId: z.string().uuid("invoiceId must be a valid id.").optional(),
  vendorBillId: z.string().uuid("vendorBillId must be a valid id.").optional(),
  source: z.enum(["INVOICE", "VENDOR_BILL", "MANUAL_ADJUSTMENT"]).optional(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/**
 * FRS 17.3 "Finance can create manual adjustment entries", and Section 37 Q16
 * ("should Finance be able to override computed GST amounts?" -> Yes).
 *
 * The override is deliberately expressed as a separate signed entry rather than
 * an edit of the row an invoice produced: an auto-generated row must always
 * still tie back to the document it came from, or the reconciliation in the
 * period summary stops meaning anything. A period total is therefore fully
 * adjustable while every individual source row stays truthful.
 */
export const createAdjustmentSchema = z
  .object({
    direction: z.enum(GST_DIRECTIONS, {
      errorMap: () => ({ message: `Direction must be one of: ${GST_DIRECTIONS.join(", ")}.` }),
    }),
    documentDate: isoDate,
    gstRate: taxRate,
    taxableAmount: signedMoney("Taxable amount"),
    cgstAmount: signedMoney("CGST amount").optional().default(0),
    sgstAmount: signedMoney("SGST amount").optional().default(0),
    igstAmount: signedMoney("IGST amount").optional().default(0),
    // Mandatory, and mandatory for a reason: an unexplained hand-posted tax
    // figure is the single hardest thing for a CA to sign off on later.
    note: z.string().trim().min(5, "A reason for the adjustment is required.").max(500),
  })
  .strict()
  .refine((v) => v.cgstAmount !== 0 || v.sgstAmount !== 0 || v.igstAmount !== 0, {
    message: "An adjustment must move at least one of CGST, SGST or IGST.",
  })
  .refine((v) => !(v.igstAmount !== 0 && (v.cgstAmount !== 0 || v.sgstAmount !== 0)), {
    message:
      "A supply is either intra-state (CGST + SGST) or inter-state (IGST), never both. " +
      "Post IGST on its own, or CGST and SGST together.",
  });

// ---------------------------------------------------------------------------
// Filing periods
// ---------------------------------------------------------------------------

export const createPeriodSchema = z
  .object({
    periodMonth: z.number().int().min(1, "Month must be 1-12.").max(12, "Month must be 1-12."),
    periodYear: z
      .number()
      .int()
      .min(2000, "Year looks out of range.")
      .max(2100, "Year looks out of range."),
  })
  .strict();

export const listPeriodsQuerySchema = z.object({
  status: z.enum(GST_FILING_STATUSES).optional(),
  periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const periodIdParamSchema = z.object({
  periodId: z.string().uuid("Invalid filing period id."),
});

export const gstTransactionIdParamSchema = z.object({
  id: z.string().uuid("Invalid GST transaction id."),
});

/** PATCH /gst/periods/:periodId/prepare -- FRS 29.8 "Mark In Preparation/Ready". */
export const preparePeriodSchema = z
  .object({
    status: z.enum(["IN_PREPARATION", "READY"], {
      errorMap: () => ({ message: "Status must be IN_PREPARATION or READY." }),
    }),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();

/** PATCH /gst/periods/:periodId/mark-filed -- FRS 29.8 "Mark Filed + store reference". */
export const markFiledSchema = z
  .object({
    // The portal's acknowledgement/ARN, if the person filing has it to hand.
    // Optional here and settable later via /acknowledge, because staff often
    // mark the period done before the ARN comes back.
    referenceNo: z.string().trim().min(1).max(100).optional(),
    filedDate: isoDate.optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();

export const acknowledgeSchema = z
  .object({
    referenceNo: z
      .string()
      .trim()
      .min(1, "An acknowledgement/ARN reference is required.")
      .max(100),
    acknowledgedDate: isoDate.optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Summaries and reports
// ---------------------------------------------------------------------------

export const gstSummaryQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, {
    message: "`from` must not be after `to`.",
  });
