// Zod layer for Vendor Bills / Accounts Payable (FRS Sections 16.2, 16.3, 20,
// 22, 29.7).
//
// Schemas are .strict() so an unknown key -- or an attempt to PATCH a
// system-derived column like `status` or `totalAmount` -- is a clean 400 rather
// than being silently dropped. Section 26 rule 9 makes Paid/Partially Paid
// derived from payment sums, and its AP mirror is applied here too: there is
// deliberately no schema anywhere in this file that lets a caller set a status.

import { z } from "zod";
import { isoDate } from "../../utils/zodDate.js";
import { positiveMoney, nonNegativeMoney, taxRate, currency } from "../../utils/zodMoney.js";

// FRS 27 / the live VendorBillStatus enum.
export const VENDOR_BILL_STATUSES = [
  "DRAFT",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
];

// FRS Section 20: "Bank Transfer / Cheque / Cash / Card / UPI", plus the
// PETTY_CASH and OTHER the invoices module already carries. Money out uses the
// same list as money in -- Section 20 defines one shape for both directions.
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "UPI", "PETTY_CASH", "OTHER"];

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);

// The vendor's OWN reference, unlike an invoice number which this system
// issues. Unique per vendor at the database level, which is what stops the same
// bill being entered -- and paid -- twice.
const billNumber = z.string().trim().min(1, "Bill number is required.").max(100);
const poReference = z.string().trim().min(1).max(100);
const paymentTerms = z.string().trim().min(1).max(100);
const notes = z.string().trim().min(1).max(2000);
const reason = z.string().trim().min(1, "A reason is required.").max(500);

// ---------------------------------------------------------------------------
// Line items (FRS 16.3 "amount, tax"; Section 28 VendorBillItem)
// ---------------------------------------------------------------------------

// Deliberately simpler than an invoice line: the Section 28 VendorBillItem has
// description/amount/taxRate and no quantity, rate or discount. A vendor bill
// is transcribed from a document the vendor sent, so the figure that matters is
// the amount they charged -- re-deriving it from a quantity this system never
// saw would invite a transcription that disagrees with the paper bill.
//
// `amount` is the TAXABLE value of the line, exclusive of tax, so it can be
// used directly as GstTransaction.taxableAmount (Section 17.4) without having
// to unwind tax back out of it.
const lineItemSchema = z
  .object({
    description: z.string().trim().min(1, "Line item description is required.").max(500),
    amount: nonNegativeMoney("Line amount"),
    // Decimal(5,2) NOT NULL in the schema with no default, so a bill that omits
    // it is stored as 0 rather than rejected -- plenty of vendor charges carry
    // no GST.
    taxRate: taxRate.optional(),
  })
  .strict();

const lineItems = z
  .array(lineItemSchema)
  .min(1, "A vendor bill needs at least one line item.")
  .max(200, "A vendor bill cannot have more than 200 line items.");

// ---------------------------------------------------------------------------
// Vendor bill
// ---------------------------------------------------------------------------

const dueAfterBillDate = (body) => {
  if (!body.billDate || !body.dueDate) return true;
  return body.dueDate >= body.billDate;
};
const DUE_AFTER_BILL = {
  message: "dueDate must be on or after billDate.",
  path: ["dueDate"],
};

// `status` is not accepted: every bill starts as DRAFT and moves through the
// Section 16.2 endpoints. `totalAmount` is not accepted either -- it is
// computed from the line items, and letting a caller state it would allow the
// stored total to disagree with the lines it is supposed to be the sum of.
export const createVendorBillSchema = z
  .object({
    vendorId: uuid("vendorId"),
    billNumber,
    // FRS 19: a vendor bill can be tagged to a PROJECT scope. Optional, because
    // most vendor spend (cloud, ISP, office) is company overhead.
    projectId: uuid("projectId").optional(),
    billDate: isoDate,
    dueDate: isoDate,
    // FRS 16.2: verification is "Finance checks against contract/PO". Records
    // what was checked against without modelling a PurchaseOrder entity, which
    // Section 16.3 flags as a Phase 2 candidate pending Section 38 Q31.
    poReference: poReference.optional(),
    paymentTerms: paymentTerms.optional(), // defaults from the vendor record
    currency: currency.optional(), // defaults from the vendor record
    notes: notes.optional(),
    lineItems,
  })
  .strict()
  .refine(dueAfterBillDate, DUE_AFTER_BILL);

// Editing is DRAFT-only (enforced in the service): once a bill has been sent
// for verification, changing its figures underneath the verifier and approver
// would defeat both. Sending `lineItems` replaces the whole set -- there is no
// per-line PATCH or DELETE endpoint, which is what keeps lines from being
// removed off a bill that is already in the workflow (Section 26 rule 6).
export const updateVendorBillSchema = z
  .object({
    vendorId: uuid("vendorId").optional(),
    billNumber: billNumber.optional(),
    projectId: uuid("projectId").nullable().optional(),
    billDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    poReference: poReference.nullable().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    currency: currency.optional(),
    notes: notes.nullable().optional(),
    lineItems: lineItems.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(dueAfterBillDate, DUE_AFTER_BILL);

// FRS 16.2: submit/verify/send-for-approval/approve/reopen take no payload
// beyond an optional comment, which is recorded on the ApprovalStep row that
// Section 16.3's "approval history" reads back.
export const transitionSchema = z
  .object({
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// Reject and cancel both require a reason: Section 24 lists REJECT and CANCEL
// as audited actions with a "note (optional reason, e.g. rejection reason)",
// and a rejection nobody can explain is the one an auditor asks about.
export const reasonSchema = z
  .object({
    reason,
  })
  .strict();

export const vendorBillIdParamSchema = z.object({
  id: uuid("Vendor bill id"),
});

// Not .strict(): page/pageSize are consumed by the shared getPagination helper,
// exactly as the clients/projects/invoices list queries do.
export const listVendorBillsQuerySchema = z.object({
  status: z.enum(VENDOR_BILL_STATUSES).optional(),
  vendorId: uuid("vendorId").optional(),
  projectId: uuid("projectId").optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  // "Show me what we still owe" -- the Section 16.3 outstanding view, as a
  // filter rather than a separate endpoint.
  outstandingOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // VendorBillStatus has no OVERDUE member (unlike InvoiceStatus), so "past
  // due" is derived from dueDate rather than read off the status column.
  overdueOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // Section 23 "Vendor bill due soon | Finance Admin" -- the query behind that
  // notification, available now even though the notification feed is Phase 2.
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Vendor payments (FRS 16.3, 20, 29.7 POST /vendor-bills/:id/payments)
// ---------------------------------------------------------------------------

// FRS 16.3 names partial payment and outstanding amount explicitly, so `amount`
// is any positive value up to the outstanding balance -- the balance check
// needs the bill, so it lives in the service.
export const recordVendorPaymentSchema = z
  .object({
    amount: positiveMoney("Payment amount"),
    paymentDate: isoDate,
    method: z.enum(PAYMENT_METHODS),
    referenceNo: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// AP report (FRS 22 "Vendor Payable | Vendor, date range | Super Admin,
// Finance Admin")
// ---------------------------------------------------------------------------

export const payableReportQuerySchema = z.object({
  vendorId: uuid("vendorId").optional(),
  projectId: uuid("projectId").optional(),
  // Section 22 gives this report a date range; it filters on bill date.
  from: isoDate.optional(),
  to: isoDate.optional(),
  // "As at" date for the aging buckets. Defaults to today; supplying it is how
  // a month-end payable position is reproduced after the fact.
  asOf: isoDate.optional(),
});
