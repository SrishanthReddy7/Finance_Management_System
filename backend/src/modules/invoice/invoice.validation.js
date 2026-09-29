// Zod layer for Invoicing & AR (FRS Sections 14, 15, 20, 29.6).
//
// Schemas are .strict() so an unknown key -- or an attempt to PATCH a
// system-derived column like `status`, `totalAmount` or `invoiceNumber` -- is a
// clean 400 rather than being silently dropped. Section 26 rule 9 makes
// Paid/Partially Paid derived from payment sums only, so there is deliberately
// no schema anywhere in this file that lets a caller set them.

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";
import { positiveMoney, nonNegativeMoney, taxRate, currency } from "../../utils/zodMoney.js";

// FRS 27 / the live InvoiceStatus enum.
export const INVOICE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
];

// FRS Section 38 Q14 confirmed Bank Transfer and Petty Cash are the methods
// that actually exist today; Section 20 lists the rest. Kept as an enum so a
// typo becomes a 400 instead of an unfilterable free-text value in the payment
// history (FRS 15.1 "payment method").
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "UPI", "PETTY_CASH", "OTHER"];

// Dates are validated by the shared helper in utils/zodDate.js, which rejects
// impossible calendar dates ("2026-02-30") and non-ISO shapes rather than
// letting Date.parse silently roll them over. Shared rather than duplicated so
// AP and AR cannot drift apart on what a valid date is.

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

// Money, tax-rate and currency validation come from utils/zodMoney.js, shared
// with AP so both sides of the ledger reject a third decimal place the same
// way.

const notes = z.string().trim().min(1).max(2000);
const reason = z.string().trim().min(1, "A reason is required.").max(500);
const paymentTerms = z.string().trim().min(1).max(100);

// ---------------------------------------------------------------------------
// Line items (FRS 14.1: description, quantity, rate, tax, discount, line total)
// ---------------------------------------------------------------------------

// `lineTotal` is intentionally absent: it is computed server-side from
// quantity/rate/discount (see invoice.service.computeLineTotal) and stored.
// Accepting it from the caller would let the stored total disagree with the
// figures it is supposed to be derived from.
const lineItemSchema = z
  .object({
    description: z.string().trim().min(1, "Line item description is required.").max(500),
    // Decimal(10,2) and Decimal(12,2) respectively in the schema, so the caps
    // differ from the Decimal(14,2) default.
    quantity: positiveMoney("Quantity", 99_999_999.99),
    rate: nonNegativeMoney("Rate", 9_999_999_999.99),
    // FRS 17.4 GST rates. A percentage, not an amount.
    taxRate: taxRate.optional(),
    // A flat amount off this line, applied before tax (FRS 14.1 "discount").
    discount: nonNegativeMoney("Discount").optional(),
  })
  .strict();

// FRS 14.2 "Draft → Pending Approval ... Requires all mandatory fields filled":
// an invoice with no line items has no total to approve, so at least one is
// required from the moment of creation.
const lineItems = z
  .array(lineItemSchema)
  .min(1, "An invoice needs at least one line item.")
  .max(200, "An invoice cannot have more than 200 line items.");

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

const dueAfterInvoiceDate = (body) => {
  if (!body.invoiceDate || !body.dueDate) return true;
  return body.dueDate >= body.invoiceDate;
};
const DUE_AFTER_INVOICE = {
  message: "dueDate must be on or after invoiceDate.",
  path: ["dueDate"],
};

const billingPeriodOrdered = (body) => {
  if (!body.billingPeriodStart || !body.billingPeriodEnd) return true;
  return body.billingPeriodEnd >= body.billingPeriodStart;
};
const BILLING_PERIOD_ORDERED = {
  message: "billingPeriodEnd must be on or after billingPeriodStart.",
  path: ["billingPeriodEnd"],
};

// `invoiceNumber` is not accepted: it is generated server-side against the
// @unique column so two concurrent creates cannot collide, and so the sequence
// has no caller-created gaps. `status` is not accepted either -- every invoice
// starts as DRAFT and moves through the Section 14.2 endpoints.
export const createInvoiceSchema = z
  .object({
    clientId: uuid("clientId"),
    projectId: uuid("projectId").optional(),
    milestoneId: uuid("milestoneId").optional(),
    invoiceDate: isoDate,
    dueDate: isoDate,
    billingPeriodStart: isoDate.optional(),
    billingPeriodEnd: isoDate.optional(),
    paymentTerms: paymentTerms.optional(), // defaults from the client record
    currency: currency.optional(), // defaults from the client record
    notes: notes.optional(),
    lineItems,
  })
  .strict()
  .refine(dueAfterInvoiceDate, DUE_AFTER_INVOICE)
  .refine(billingPeriodOrdered, BILLING_PERIOD_ORDERED);

// Editing is DRAFT-only (enforced in the service): once an invoice has been
// submitted for approval, changing its figures underneath the approver would
// defeat the point of the approval. Sending `lineItems` replaces the whole set
// -- there is no per-line PATCH or DELETE endpoint, which is what keeps line
// items from being removed off an issued invoice (Section 26 rule 6).
export const updateInvoiceSchema = z
  .object({
    clientId: uuid("clientId").optional(),
    projectId: uuid("projectId").nullable().optional(),
    milestoneId: uuid("milestoneId").nullable().optional(),
    invoiceDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    billingPeriodStart: isoDate.nullable().optional(),
    billingPeriodEnd: isoDate.nullable().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    currency: currency.optional(),
    notes: notes.nullable().optional(),
    lineItems: lineItems.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(dueAfterInvoiceDate, DUE_AFTER_INVOICE)
  .refine(billingPeriodOrdered, BILLING_PERIOD_ORDERED);

// FRS 14.2: submit/approve/send take no payload beyond an optional comment,
// which is recorded on the ApprovalStep row for the status timeline.
export const transitionSchema = z
  .object({
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// "Any non-terminal → Cancelled | Requires reason; audit-logged" (FRS 14.2).
// The reason is mandatory, so it is a separate schema from transitionSchema.
export const cancelInvoiceSchema = z
  .object({
    reason,
  })
  .strict();

export const invoiceIdParamSchema = z.object({
  id: uuid("Invoice id"),
});

export const documentIdParamSchema = z.object({
  id: uuid("Invoice id"),
  documentId: uuid("Document id"),
});

// Not .strict(): page/pageSize are consumed by the shared getPagination helper,
// exactly as the clients/projects/expenses list queries do.
export const listInvoicesQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  clientId: uuid("clientId").optional(),
  projectId: uuid("projectId").optional(),
  milestoneId: uuid("milestoneId").optional(),
  // FRS 31 "List/filter by status" plus the date-range filter Section 22 wants
  // on every invoice-shaped report.
  from: isoDate.optional(),
  to: isoDate.optional(),
  // "Show me what is still owed" -- the Section 15.2 derived view, as a filter
  // rather than a separate endpoint.
  outstandingOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  overdueOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Client payments (FRS 15.1, 20, 29.6 POST /invoices/:id/payments)
// ---------------------------------------------------------------------------

// Section 38 Q26 confirmed partial payments are normal, so `amount` is any
// positive value up to the outstanding balance -- the balance check needs the
// invoice, so it lives in the service.
export const recordPaymentSchema = z
  .object({
    amount: positiveMoney("Payment amount"),
    paymentDate: isoDate,
    method: z.enum(PAYMENT_METHODS),
    referenceNo: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// AR reports (FRS 15.3, 29.6 /reports/ar/*)
// ---------------------------------------------------------------------------

export const arReportQuerySchema = z.object({
  clientId: uuid("clientId").optional(),
  projectId: uuid("projectId").optional(),
  // "As at" date for the aging buckets. Defaults to today; supplying it is how
  // a month-end AR position is reproduced after the fact.
  asOf: isoDate.optional(),
});

export const clientPaymentReportQuerySchema = z.object({
  clientId: uuid("clientId").optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
