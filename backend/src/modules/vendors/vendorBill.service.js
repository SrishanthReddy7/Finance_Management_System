// Vendor Bills / Accounts Payable (FRS Sections 16.2, 16.3, 19, 20, 22, 29.7).
//
// The mirror of the invoices module: an invoice is money the company is owed, a
// vendor bill is money the company owes. Where a rule exists on both sides it
// is deliberately implemented the same way here, and the shared pieces (date
// validation, money validation, the CGST/SGST/IGST split, the approval-history
// and audit writers) are imported rather than re-derived.
//
// What lives here: line-item arithmetic, the Section 16.2 status lifecycle,
// the INPUT-tax GST split, payment recording, and the Section 22 Vendor Payable
// derivations. Permission gating does NOT live here -- MANAGE_VENDORS /
// VERIFY_VENDOR_BILL / APPROVE_VENDOR_BILL / RECORD_VENDOR_PAYMENT are applied
// at the route layer via requirePermission, which carries the Section 30 Super
// Admin bypass.
//
// The one authorization rule that IS here is maker-checker: it compares the
// approver against the bill's own createdById, so it needs the record and
// cannot be expressed as a permission code.
//
// Nothing is hard-deleted (Section 26 rule 6 / FR-18). A bill is retired by
// moving it to CANCELLED with a reason.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";
import { recordApprovalStep, listApprovalSteps } from "../../utils/approvalHistory.js";
import { resolveGstTreatment as resolveGstTreatmentFor, buildGstTransactions } from "../../utils/gst.js";
import { resolveFilingPeriod, formatPeriodLabel, isPeriodLocked } from "../../utils/gstPeriod.js";
import { assertProjectAssignable } from "../projects/project.service.js";
import { getProjectBudgetWarnings } from "../budgets/budget.service.js";
import { assertVendorAssignable, redactVendor } from "./vendor.service.js";
import { ACTUAL_BILL_STATUSES, PENDING_BILL_STATUSES } from "./vendorBill.constants.js";
import { buildCurrencyCaveats } from "../../utils/currency.js";

const ENTITY_TYPE = "VendorBill";
const PAYMENT_ENTITY_TYPE = "VendorPayment";
const GST_ENTITY_TYPE = "GstTransaction";

/** Place of supply for an INPUT-tax document: the counterparty is the vendor. */
const resolveGstTreatment = (vendorGstin) => resolveGstTreatmentFor(vendorGstin, "VENDOR_GSTIN_MISSING");

// Audit snapshots carry changed fields only (Section 24).
const BILL_FIELDS = [
  "vendorId",
  "projectId",
  "billNumber",
  "billDate",
  "dueDate",
  "poReference",
  "paymentTerms",
  "currency",
  "notes",
  "totalAmount",
  "status",
];

/**
 * FRS 16.2's workflow -- "Vendor Bill Created -> Verification -> Approval ->
 * Payment -> Payment Record" -- expanded into the Section 16.3 state chain
 * "Draft -> Pending Verification -> Verified -> Pending Approval -> Approved ->
 * Partially Paid -> Paid, plus Rejected/Cancelled", as a table rather than
 * prose.
 *
 * The client confirmed the verification sub-step is kept rather than merged
 * into approval (the Section 34 MVP shortcut was declined), which is also what
 * Sections 27 and 29.7 and the live VendorBillStatus enum already assume.
 *
 * PARTIALLY_PAID and PAID are reachable only from recordPayment: Section 26
 * rule 9 makes them "always system-derived from payment sums, never manually
 * settable" for invoices, and the same rule is applied to their AP mirror. No
 * endpoint in this module accepts either as a target.
 *
 * REJECTED is not terminal, and has exactly one exit: back to DRAFT. Section 26
 * rule 6 forbids deleting the row, and @@unique([vendorId, billNumber]) forbids
 * re-entering the same bill under the same number -- so without a way back, one
 * typo would permanently lock a legitimate vendor bill out of the system. This
 * is the same role RETURNED plays in the expense workflow (Section 11.4).
 */
const STATUS_TRANSITIONS = {
  DRAFT: ["PENDING_VERIFICATION", "CANCELLED"],
  PENDING_VERIFICATION: ["VERIFIED", "REJECTED", "CANCELLED"],
  VERIFIED: ["PENDING_APPROVAL", "REJECTED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PARTIALLY_PAID", "PAID", "CANCELLED"],
  PARTIALLY_PAID: ["PAID", "CANCELLED"],
  REJECTED: ["DRAFT"],
  PAID: [],
  CANCELLED: [],
};

// Paid and cancelled are final. A correction to a paid bill is a debit note,
// which this module does not model (the same boundary invoices draw at credit
// notes).
const TERMINAL_STATUSES = ["PAID", "CANCELLED"];

// A bill is editable only while it is a DRAFT. Once it has gone for
// verification, changing the figures underneath the verifier and the approver
// would defeat both checks.
const EDITABLE_STATUSES = ["DRAFT"];

// The point the company owes money: FRS 16.2 puts Payment after Approval, so a
// bill that has not been approved cannot be paid.
const PAYABLE_STATUSES = ["APPROVED", "PARTIALLY_PAID"];

// What counts as a payable for the Section 22 Vendor Payable report. CANCELLED
// and REJECTED are excluded (nothing is owed) and so is PAID (nothing is left).
const OUTSTANDING_STATUSES = ["APPROVED", "PARTIALLY_PAID"];

// Where a reviewer can say no. After approval the only way out is cancellation,
// which is a different act with a different permission.
const REJECTABLE_STATUSES = ["PENDING_VERIFICATION", "VERIFIED", "PENDING_APPROVAL"];

// Re-exported so callers that already import this service do not need to know
// the constants live in their own file (see vendorBill.constants.js for why).
export { ACTUAL_BILL_STATUSES, PENDING_BILL_STATUSES };

// Standard aging buckets, the same ones the AR aging report uses, so payables
// and receivables can be read side by side.
const AGING_BUCKETS = [
  { key: "current", label: "Not yet due", min: null, max: 0 },
  { key: "d0_30", label: "0-30 days", min: 1, max: 30 },
  { key: "d31_60", label: "31-60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61-90 days", min: 61, max: 90 },
  { key: "d90_plus", label: "90+ days", min: 91, max: null },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const VENDOR_SELECT = {
  id: true,
  name: true,
  category: true,
  status: true,
  currency: true,
  gstin: true,
  paymentTerms: true,
  bankDetails: true,
};
const PROJECT_SELECT = { id: true, name: true, status: true, clientId: true };
const LINE_ITEM_SELECT = { id: true, description: true, amount: true, taxRate: true };
const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paymentDate: true,
  method: true,
  referenceNo: true,
  note: true,
  recordedAt: true,
};

const BILL_INCLUDE = {
  vendor: { select: VENDOR_SELECT },
  project: { select: PROJECT_SELECT },
  items: { select: LINE_ITEM_SELECT },
  payments: { select: PAYMENT_SELECT, orderBy: { paymentDate: "asc" } },
};

// ---------------------------------------------------------------------------
// Small numeric / date helpers -- Prisma hands back Decimal, not Number.
// ---------------------------------------------------------------------------

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Dates are floored to whole UTC days before anything is compared or counted.
 * "Past due" and the aging buckets are day-grained concepts: without this a
 * bill due today reads as overdue by a fraction of a day, and two calls to the
 * payable report hours apart disagree about which bucket a row is in.
 */
function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(from, to) {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Line-item arithmetic (FRS 16.3 "amount, tax")
// ---------------------------------------------------------------------------

/**
 * Rolls a bill's line items up into the header figures.
 *
 * `amount` on a VendorBillItem is the taxable value, exclusive of tax -- which
 * is what lets it be used directly as GstTransaction.taxableAmount. Tax is
 * summed per line and only then rolled into the header, so a bill with lines at
 * mixed GST rates totals to the same number the per-rate GST transactions do.
 */
function computeTotals(items) {
  let subtotal = 0;
  let taxTotal = 0;

  const priced = items.map((item) => {
    const amount = round2(num(item.amount));
    const rate = round2(num(item.taxRate));
    const taxAmount = round2((amount * rate) / 100);

    subtotal = round2(subtotal + amount);
    taxTotal = round2(taxTotal + taxAmount);

    return { description: item.description, amount, taxRate: rate, taxAmount, lineTotal: amount };
  });

  return { lineItems: priced, subtotal, taxTotal, totalAmount: round2(subtotal + taxTotal) };
}

// ---------------------------------------------------------------------------
// Relationship validation (server-side, per FRS 8.3 / 32)
// ---------------------------------------------------------------------------

/**
 * `requireActiveVendor` is false when re-validating a bill that already exists,
 * so a vendor going INACTIVE later never freezes an in-flight bill.
 */
async function resolveRelations({ vendorId, projectId }, { requireActiveVendor = true } = {}) {
  const vendor = await assertVendorAssignable(vendorId, { requireActive: requireActiveVendor });

  let project = null;
  if (projectId) {
    // Reuses the projects module's own guard rather than re-deriving the rule,
    // so a cancelled project is refused here exactly as it is for expenses and
    // invoices.
    await assertProjectAssignable(projectId);
    project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
  }

  return { vendor, project };
}

/**
 * The vendor's bill number is unique per vendor at the database level. Checked
 * here first so the caller gets a message naming the bill they have already
 * entered, rather than the generic "Duplicate value for: vendorId_billNumber"
 * the P2002 handler would produce. The constraint is still what guarantees it
 * under a race.
 */
async function assertBillNumberFree(vendorId, billNumber, excludeId = null) {
  const clash = await prisma.vendorBill.findFirst({
    where: { vendorId, billNumber, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, billNumber: true, status: true, totalAmount: true, billDate: true },
  });
  if (clash) {
    throw new AppError(
      409,
      `Bill number "${billNumber}" is already recorded against this vendor (status ${clash.status}, ` +
        `${round2(num(clash.totalAmount))} dated ${new Date(clash.billDate).toISOString().slice(0, 10)}). ` +
        "Entering it twice is how a vendor gets paid twice."
    );
  }
}

// ---------------------------------------------------------------------------
// Warnings (non-blocking) -- the "warn, do not block" shape the expenses,
// clients and invoices modules already use for judgement calls.
// ---------------------------------------------------------------------------

async function buildBillWarnings({ vendor, project, totals, currency, treatment, billId = null, billDate }) {
  const warnings = [];

  if (!treatment.applicable && totals.taxTotal > 0) {
    warnings.push(
      treatment.reason === "COMPANY_GSTIN_NOT_CONFIGURED"
        ? {
            code: "GST_REGISTRATION_NOT_CONFIGURED",
            message:
              "COMPANY_GSTIN is not set, so no CGST/SGST/IGST breakdown will be recorded for this bill and its " +
              "input tax credit cannot be classified. The bill total still includes tax. Set COMPANY_GSTIN and " +
              "re-approve to record the split.",
          }
        : {
            code: "VENDOR_GSTIN_MISSING",
            message:
              `Vendor "${vendor.name}" has no GSTIN on record, so the place of supply could not be determined and ` +
              "no CGST/SGST/IGST breakdown will be recorded. Input tax credit normally requires the supplier's GSTIN.",
          }
    );
  }

  if (vendor.status !== "ACTIVE") {
    warnings.push({
      code: "VENDOR_NOT_ACTIVE",
      message: `Vendor "${vendor.name}" is ${vendor.status}.`,
    });
  }

  if (vendor.currency && currency && vendor.currency !== currency) {
    warnings.push({
      code: "CURRENCY_MISMATCH",
      message: `This bill is in ${currency} but vendor "${vendor.name}" is set up in ${vendor.currency}.`,
    });
  }

  // The classic AP failure: the same bill arrives twice under two different
  // reference numbers (a resend, a PDF and its scan) and gets paid twice. The
  // unique constraint cannot see it because the numbers differ, so it is
  // surfaced here. A warning, not a 409 -- a vendor genuinely can raise two
  // identical charges on one day.
  if (billDate && totals.totalAmount > 0) {
    const sameDaySameAmount = await prisma.vendorBill.findMany({
      where: {
        vendorId: vendor.id,
        billDate: startOfUtcDay(billDate),
        totalAmount: totals.totalAmount,
        status: { notIn: ["CANCELLED", "REJECTED"] },
        ...(billId ? { id: { not: billId } } : {}),
      },
      select: { id: true, billNumber: true, status: true },
    });
    if (sameDaySameAmount.length > 0) {
      warnings.push({
        code: "POSSIBLE_DUPLICATE_BILL",
        message:
          `${sameDaySameAmount.length} other bill(s) from "${vendor.name}" carry the same date and the same total ` +
          `of ${totals.totalAmount}. Check this is not the same bill entered twice under a different number.`,
        bills: sameDaySameAmount,
      });
    }
  }

  if (project && project.status !== "ACTIVE") {
    warnings.push({
      code: "PROJECT_NOT_ACTIVE",
      message: `Project "${project.name}" is ${project.status}; this cost will still count toward its actuals.`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Presentation -- the Section 16.3 derived values
// ---------------------------------------------------------------------------

/**
 * FRS 16.3 names "payment status, partial payment, outstanding amount" as bill
 * fields. Outstanding is derived, never stored:
 *   Amount Paid = sum of all VendorPayment rows linked to the bill
 *   Outstanding = Bill Total - Amount Paid
 *
 * `isOverdue` is computed on every read from dueDate rather than read off the
 * status column -- VendorBillStatus has no OVERDUE member, so there is nothing
 * to read, and deriving it means no sweep job is needed for the figure to be
 * right.
 */
function decorateBill(bill, actingUser, { asOf = new Date() } = {}) {
  const payments = bill.payments || [];
  const items = (bill.items || []).map((li) => {
    const amount = round2(num(li.amount));
    const rate = round2(num(li.taxRate));
    return { ...li, amount, taxRate: rate, taxAmount: round2((amount * rate) / 100) };
  });

  const subtotal = round2(items.reduce((s, li) => s + li.amount, 0));
  const taxTotal = round2(items.reduce((s, li) => s + li.taxAmount, 0));

  const totalAmount = round2(num(bill.totalAmount));
  const amountPaid = round2(payments.reduce((s, p) => s + num(p.amount), 0));
  const outstandingAmount = round2(totalAmount - amountPaid);

  const settled = TERMINAL_STATUSES.includes(bill.status) || bill.status === "REJECTED";
  const daysPastDue = daysBetween(bill.dueDate, asOf);
  const isOverdue = !settled && outstandingAmount > 0 && daysPastDue > 0;

  return {
    ...bill,
    totalAmount,
    // Bank details travel on the nested vendor, so the same per-caller
    // redaction has to apply here as on GET /vendors.
    vendor: bill.vendor ? redactVendor(bill.vendor, actingUser) : bill.vendor,
    items,
    payments: payments.map((p) => ({ ...p, amount: round2(num(p.amount)) })),
    totals: { subtotal, taxTotal, totalAmount },
    ap: {
      amountPaid,
      outstandingAmount,
      isOverdue,
      daysPastDue: daysPastDue > 0 ? daysPastDue : 0,
      paymentCount: payments.length,
      isFullyPaid: outstandingAmount <= 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listVendorBills(
  { status, vendorId, projectId, from, to, outstandingOnly, overdueOnly, dueWithinDays, search, skip, take },
  actingUser
) {
  const filters = [];

  if (status) filters.push({ status });
  if (vendorId) filters.push({ vendorId });
  if (projectId) filters.push({ projectId });
  if (from) filters.push({ billDate: { gte: startOfUtcDay(from) } });
  if (to) filters.push({ billDate: { lte: startOfUtcDay(to) } });
  if (outstandingOnly) filters.push({ status: { in: OUTSTANDING_STATUSES } });
  if (overdueOnly) {
    // Derived from dueDate, not from a status column, because there is no
    // OVERDUE status on a vendor bill to go stale.
    filters.push({ status: { in: OUTSTANDING_STATUSES }, dueDate: { lt: startOfUtcDay(new Date()) } });
  }
  if (dueWithinDays !== undefined) {
    // FRS Section 23 "Vendor bill due soon | Finance Admin".
    const horizon = new Date(startOfUtcDay(new Date()).getTime() + dueWithinDays * MS_PER_DAY);
    filters.push({ status: { in: OUTSTANDING_STATUSES }, dueDate: { lte: horizon } });
  }
  if (search) {
    filters.push({
      OR: [
        { billNumber: { contains: search, mode: "insensitive" } },
        { poReference: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { vendor: { name: { contains: search, mode: "insensitive" } } },
        { project: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where = filters.length > 0 ? { AND: filters } : {};

  const [rows, totalCount] = await Promise.all([
    prisma.vendorBill.findMany({
      where,
      skip,
      take,
      orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
      include: {
        vendor: { select: VENDOR_SELECT },
        project: { select: PROJECT_SELECT },
        items: { select: LINE_ITEM_SELECT },
        payments: { select: { amount: true } },
        _count: { select: { items: true, payments: true } },
      },
    }),
    prisma.vendorBill.count({ where }),
  ]);

  return { rows: rows.map((row) => decorateBill(row, actingUser)), totalCount };
}

export async function getVendorBillOr404(billId, actingUser) {
  const bill = await prisma.vendorBill.findUnique({
    where: { id: billId },
    include: BILL_INCLUDE,
  });
  if (!bill) throw new AppError(404, "Vendor bill not found.");

  const decorated = decorateBill(bill, actingUser);

  const [gstTransactions, approvalHistory] = await Promise.all([
    prisma.gstTransaction.findMany({
      where: { vendorBillId: billId },
      select: {
        id: true,
        direction: true,
        gstRate: true,
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        filingPeriodId: true,
      },
      orderBy: { gstRate: "asc" },
    }),
    // FRS 16.3 "approval history".
    listApprovalSteps(ENTITY_TYPE, billId),
  ]);

  return {
    ...decorated,
    gst: {
      transactions: gstTransactions.map((t) => ({
        ...t,
        gstRate: round2(num(t.gstRate)),
        taxableAmount: round2(num(t.taxableAmount)),
        cgstAmount: round2(num(t.cgstAmount)),
        sgstAmount: round2(num(t.sgstAmount)),
        igstAmount: round2(num(t.igstAmount)),
      })),
      // Input tax credit: what the company paid its vendor and can offset
      // against output tax (FRS 17 "Input tax").
      totalInputTax: round2(
        gstTransactions.reduce((s, t) => s + num(t.cgstAmount) + num(t.sgstAmount) + num(t.igstAmount), 0)
      ),
    },
    approvalHistory,
  };
}

/** FRS 16.3 "payment history". Scoped to the bill in the URL. */
export async function listPayments(billId) {
  const bill = await prisma.vendorBill.findUnique({
    where: { id: billId },
    select: { id: true, billNumber: true, totalAmount: true, currency: true, status: true, vendorId: true },
  });
  if (!bill) throw new AppError(404, "Vendor bill not found.");

  const payments = await prisma.vendorPayment.findMany({
    where: { vendorBillId: billId },
    select: PAYMENT_SELECT,
    orderBy: { paymentDate: "asc" },
  });

  const totalAmount = round2(num(bill.totalAmount));
  const amountPaid = round2(payments.reduce((s, p) => s + num(p.amount), 0));

  return {
    bill: { ...bill, totalAmount },
    payments: payments.map((p) => ({ ...p, amount: round2(num(p.amount)) })),
    amountPaid,
    outstandingAmount: round2(totalAmount - amountPaid),
  };
}

/**
 * Guard for any module that needs to reference a vendor bill (the GST module's
 * manual adjustments, the Budgets module's actuals). Exported now so those
 * reuse the rule instead of re-deriving it, mirroring assertInvoiceExists.
 */
export async function assertVendorBillExists(billId) {
  if (!billId) return null;
  const bill = await prisma.vendorBill.findUnique({
    where: { id: billId },
    select: { id: true, billNumber: true, status: true, vendorId: true, projectId: true },
  });
  if (!bill) throw new AppError(400, "The specified vendor bill does not exist.");
  return bill;
}

// ---------------------------------------------------------------------------
// Writes -- create / edit
// ---------------------------------------------------------------------------

export async function createVendorBill(actingUser, input) {
  const { vendor, project } = await resolveRelations(input);
  await assertBillNumberFree(input.vendorId, input.billNumber);

  const totals = computeTotals(input.lineItems);
  const currency = input.currency || vendor.currency || "INR";
  const treatment = resolveGstTreatment(vendor.gstin);

  const bill = await prisma.$transaction(async (tx) => {
    const row = await tx.vendorBill.create({
      data: {
        vendorId: input.vendorId,
        projectId: input.projectId ?? null,
        billNumber: input.billNumber,
        billDate: input.billDate,
        dueDate: input.dueDate,
        poReference: input.poReference ?? null,
        // Snapshotted off the vendor when the caller does not state terms, so
        // the bill records what was agreed at the time.
        paymentTerms: input.paymentTerms ?? vendor.paymentTerms ?? null,
        currency,
        notes: input.notes ?? null,
        totalAmount: totals.totalAmount,
        createdById: actingUser.id,
        // status omitted so the schema default DRAFT applies.
        items: {
          create: totals.lineItems.map((li) => ({
            description: li.description,
            amount: li.amount,
            taxRate: li.taxRate,
          })),
        },
      },
    });

    // Section 26 rule 7 / Section 24: the audit row commits with the change it
    // records, never separately.
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          billNumber: row.billNumber,
          vendorId: row.vendorId,
          projectId: row.projectId,
          billDate: new Date(row.billDate).toISOString(),
          dueDate: new Date(row.dueDate).toISOString(),
          totalAmount: totals.totalAmount,
          currency: row.currency,
          status: row.status,
          lineItemCount: totals.lineItems.length,
        },
      },
      tx
    );

    return row;
  });

  const warnings = await buildBillWarnings({
    vendor,
    project,
    totals,
    currency,
    treatment,
    billId: bill.id,
    billDate: input.billDate,
  });

  return { ...(await getVendorBillOr404(bill.id, actingUser)), warnings };
}

export async function updateVendorBill(actingUser, billId, input) {
  const existing = await prisma.vendorBill.findUnique({
    where: { id: billId },
    include: { items: { select: LINE_ITEM_SELECT } },
  });
  if (!existing) throw new AppError(404, "Vendor bill not found.");

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new AppError(
      409,
      `Only a DRAFT vendor bill can be edited; this one is ${existing.status}. ` +
        (existing.status === "REJECTED"
          ? "Reopen it first (PATCH /vendor-bills/:id/reopen) to correct and resubmit it."
          : "Cancel it and enter a replacement if the figures are wrong.")
    );
  }

  // Validate against the MERGED state, not just the supplied keys: changing
  // only projectId must still be checked against the vendor already on the
  // bill, and vice versa.
  const merged = {
    vendorId: input.vendorId ?? existing.vendorId,
    projectId: input.projectId === undefined ? existing.projectId : input.projectId,
  };

  // resolveRelations/assertVendorAssignable document that requireActiveVendor
  // should be false "when re-validating a bill that already exists, so a
  // vendor going INACTIVE later never freezes an in-flight bill" -- but this
  // call was passing no override, which meant an inherited default of true.
  // In practice that meant a DRAFT bill against a vendor that went INACTIVE
  // after creation could never be edited again (not even a typo in notes, and
  // not even a REJECTED bill reopened for correction), contradicting both that
  // comment and this one's own doc-comment. Requiring an active vendor still
  // applies when the PATCH itself assigns a *different* vendor to the bill --
  // that is the same "entering a bill against this vendor" act createVendorBill
  // makes, and relaxing it there would let PATCH silently launder a bill onto
  // an inactive vendor that POST already refuses.
  const vendorChanged = input.vendorId !== undefined && input.vendorId !== existing.vendorId;
  const { vendor, project } = await resolveRelations(merged, { requireActiveVendor: vendorChanged });

  const billNumber = input.billNumber ?? existing.billNumber;
  if (input.billNumber !== undefined || input.vendorId !== undefined) {
    await assertBillNumberFree(merged.vendorId, billNumber, billId);
  }

  // Same for the date pair -- a PATCH of dueDate alone still has to sit after
  // the billDate already stored.
  const billDate = input.billDate ?? existing.billDate;
  const dueDate = input.dueDate ?? existing.dueDate;
  if (new Date(dueDate) < new Date(billDate)) {
    throw new AppError(400, "dueDate must be on or after billDate.");
  }

  const totals = input.lineItems ? computeTotals(input.lineItems) : computeTotals(existing.items);
  const currency = input.currency ?? existing.currency;

  await prisma.$transaction(async (tx) => {
    if (input.lineItems) {
      // Line items are replaced as a set. This is an edit of a DRAFT that has
      // never entered the workflow -- not a deletion of an approved financial
      // record -- and the before/after totals are captured in the audit entry
      // below, which is what Section 26 rule 6 is protecting.
      await tx.vendorBillItem.deleteMany({ where: { vendorBillId: billId } });
      await tx.vendorBillItem.createMany({
        data: totals.lineItems.map((li) => ({
          vendorBillId: billId,
          description: li.description,
          amount: li.amount,
          taxRate: li.taxRate,
        })),
      });
    }

    const row = await tx.vendorBill.update({
      where: { id: billId },
      data: {
        ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
        ...(input.billNumber !== undefined ? { billNumber: input.billNumber } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.billDate !== undefined ? { billDate: input.billDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.poReference !== undefined ? { poReference: input.poReference } : {}),
        ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.lineItems ? { totalAmount: totals.totalAmount } : {}),
      },
    });

    // Dates and Decimals are flattened first: diffChangedFields compares with
    // !==, which treats two equal Date objects as different.
    const { previousValue, newValue, changed } = diffChangedFields(
      normaliseForDiff(existing),
      normaliseForDiff(row),
      BILL_FIELDS
    );
    if (input.lineItems) {
      previousValue.lineItemCount = existing.items.length;
      newValue.lineItemCount = totals.lineItems.length;
    }

    if (changed || input.lineItems) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: billId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }
  });

  const warnings = await buildBillWarnings({
    vendor,
    project,
    totals,
    currency,
    treatment: resolveGstTreatment(vendor.gstin),
    billId,
    billDate,
  });

  return { ...(await getVendorBillOr404(billId, actingUser)), warnings };
}

/** Dates/Decimals flattened so the audit diff doesn't report unchanged fields. */
function normaliseForDiff(row) {
  return {
    ...row,
    billDate: row.billDate ? new Date(row.billDate).toISOString() : null,
    dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
    totalAmount: row.totalAmount == null ? null : round2(num(row.totalAmount)),
  };
}

// ---------------------------------------------------------------------------
// Writes -- the Section 16.2 lifecycle
// ---------------------------------------------------------------------------

/**
 * The single source of truth for the transition table. Every lifecycle
 * endpoint and the payment path run through it, so no route can put a bill
 * into a state another route would refuse.
 */
function assertStatusTransition(existing, target) {
  if (existing.status === target) {
    throw new AppError(409, `Vendor bill is already ${target}.`);
  }
  const allowed = STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(target)) {
    throw new AppError(
      409,
      allowed.length === 0
        ? `${existing.status} is a terminal status; no further transitions are allowed.`
        : `Cannot move a ${existing.status} vendor bill to ${target}. Allowed: ${allowed.join(", ")}.`
    );
  }
}

/**
 * Applies a status change plus its two mandatory trail entries: the AuditLog
 * row (Section 24 / rule 7) and the ApprovalStep row that Section 16.3's
 * "approval history" reads back. Always called inside the caller's transaction.
 */
async function applyStatusChange(tx, { bill, target, actingUser, action, comment = null, extraData = {} }) {
  const row = await tx.vendorBill.update({
    where: { id: bill.id },
    data: { status: target, ...extraData },
  });

  await writeAuditLog(
    {
      entityType: ENTITY_TYPE,
      entityId: bill.id,
      action,
      performedById: actingUser.id,
      previousValue: { status: bill.status },
      newValue: { status: target, ...extraData },
      note: comment,
    },
    tx
  );

  await recordApprovalStep(
    {
      entityType: ENTITY_TYPE,
      entityId: bill.id,
      actorUserId: actingUser.id,
      fromStatus: bill.status,
      toStatus: target,
      comment,
    },
    tx
  );

  return row;
}

async function loadBillForTransition(billId) {
  const bill = await prisma.vendorBill.findUnique({
    where: { id: billId },
    include: { items: { select: LINE_ITEM_SELECT }, vendor: { select: VENDOR_SELECT } },
  });
  if (!bill) throw new AppError(404, "Vendor bill not found.");
  return bill;
}

/**
 * Draft -> Pending Verification. The mandatory-field check is real, not
 * decorative: a bill with no lines or a zero total has nothing to verify.
 */
export async function submitVendorBill(actingUser, billId, { comment } = {}) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "PENDING_VERIFICATION");

  if (bill.items.length === 0) {
    throw new AppError(409, "A vendor bill needs at least one line item before it can be submitted.");
  }
  if (round2(num(bill.totalAmount)) <= 0) {
    throw new AppError(409, "A vendor bill with a zero total cannot be submitted.");
  }

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, { bill, target: "PENDING_VERIFICATION", actingUser, action: "UPDATE", comment })
  );

  return getVendorBillOr404(billId, actingUser);
}

/**
 * FRS 16.2 "Verification (Finance checks against contract/PO)".
 *
 * The verifier is recorded on the bill, not just in the trail, because the
 * approver needs to see who checked it before they authorise the spend.
 */
export async function verifyVendorBill(actingUser, billId, { comment } = {}) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "VERIFIED");

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, {
      bill,
      target: "VERIFIED",
      actingUser,
      action: "UPDATE",
      comment,
      extraData: { verifiedById: actingUser.id },
    })
  );

  const result = await getVendorBillOr404(billId, actingUser);
  const warnings = [];
  if (!bill.poReference) {
    warnings.push({
      code: "NO_PO_REFERENCE",
      message:
        "This bill was verified without a PO or contract reference recorded. FRS 16.2 describes verification as " +
        "checking the bill against a contract or PO; record what it was checked against in poReference.",
    });
  }
  return { ...result, warnings };
}

/** Verified -> Pending Approval: routes a checked bill into the approval queue. */
export async function sendVendorBillForApproval(actingUser, billId, { comment } = {}) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "PENDING_APPROVAL");

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, { bill, target: "PENDING_APPROVAL", actingUser, action: "UPDATE", comment })
  );

  return getVendorBillOr404(billId, actingUser);
}

/**
 * FRS 16.2 "Approval". Maker-checker, mirrored from Section 26 rule 5 onto AP
 * at the client's direction: whoever entered the bill cannot approve it.
 *
 * Enforced for everyone, including SUPER_ADMIN. The Section 30 bypass inside
 * requirePermission answers "may this person approve vendor bills at all"; it
 * is not an exemption from segregation of duties, and for money going OUT to an
 * external party that separation is the control that matters most.
 *
 * This is also the point the GST records are written: a bill that is still
 * being checked is not yet a tax event, but an approved one is -- it is the
 * moment the company accepts the liability and with it the input tax credit
 * (Section 17.3, "GST records ... auto-created from invoices/vendor bills").
 */
export async function approveVendorBill(actingUser, billId, { comment } = {}) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "APPROVED");

  if (bill.createdById === actingUser.id) {
    throw new AppError(
      409,
      "You entered this vendor bill, so you cannot approve it. Approval must be performed by a different user " +
        "holding APPROVE_VENDOR_BILL (FRS Section 26, rule 5, applied to AP)."
    );
  }

  const treatment = resolveGstTreatment(bill.vendor.gstin);
  const priced = bill.items.map((li) => {
    const amount = round2(num(li.amount));
    const rate = round2(num(li.taxRate));
    return { taxRate: rate, lineTotal: amount, taxAmount: round2((amount * rate) / 100) };
  });
  const gstRows = buildGstTransactions(priced, treatment);

  // FRS 17.4 "tax period (month/year)". The bill date is the tax point for
  // input tax, the mirror of invoiceDate on the output side. Resolved inside
  // the transaction so the period, the GST rows and the approval commit
  // together.
  let periodOutcome = null;

  await prisma.$transaction(async (tx) => {
    await applyStatusChange(tx, {
      bill,
      target: "APPROVED",
      actingUser,
      action: "APPROVE",
      comment,
      extraData: { approvedById: actingUser.id },
    });

    if (gstRows.length > 0) {
      periodOutcome = await resolveFilingPeriod(bill.billDate, tx);
      await tx.gstTransaction.createMany({
        data: gstRows.map((row) => ({
          // Money out -> input tax, the credit side of the GST ledger
          // (FRS 17.4 GstDirection).
          direction: "INPUT",
          vendorBillId: billId,
          filingPeriodId: periodOutcome.period.id,
          documentDate: bill.billDate,
          ...row,
        })),
      });

      await writeAuditLog(
        {
          entityType: GST_ENTITY_TYPE,
          entityId: billId,
          action: "CREATE",
          performedById: actingUser.id,
          newValue: {
            billNumber: bill.billNumber,
            direction: "INPUT",
            placeOfSupply: treatment.interState ? "INTER_STATE" : "INTRA_STATE",
            filingPeriod: formatPeriodLabel(periodOutcome.period),
            transactions: gstRows,
          },
        },
        tx
      );
    }
  });

  const result = await getVendorBillOr404(billId, actingUser);
  const warnings = [];
  if (!treatment.applicable && priced.some((p) => p.taxAmount > 0)) {
    warnings.push(
      treatment.reason === "COMPANY_GSTIN_NOT_CONFIGURED"
        ? {
            code: "GST_REGISTRATION_NOT_CONFIGURED",
            message:
              "Bill approved, but COMPANY_GSTIN is not set so no input-tax records were created for it. " +
              "Set COMPANY_GSTIN before the tax period is prepared or this input tax credit will be missed.",
          }
        : {
            code: "VENDOR_GSTIN_MISSING",
            message:
              "Bill approved, but the vendor has no GSTIN so the place of supply could not be determined and no " +
              "input-tax records were created for it.",
          }
    );
  }
  // See the matching note in invoice.service.sendInvoice: a bill dated inside
  // an already-filed period has its input tax carried into the next open one,
  // because dropping it would forfeit input tax credit the company is owed.
  if (periodOutcome && periodOutcome.rolledForward) {
    warnings.push({
      code: "GST_PERIOD_ROLLED_FORWARD",
      message:
        `This bill is dated in ${periodOutcome.naturalPeriodLabel}, which has already been filed. Its input ` +
        `tax has been recorded in ${formatPeriodLabel(periodOutcome.period)} instead ` +
        "(FRS Section 26, rule 8).",
    });
  }
  // FRS 19 budget control: warn (never block -- see Handsoff.md) when this
  // bill's project has an ACTIVE budget at or over the utilization threshold.
  if (bill.projectId) {
    warnings.push(...(await getProjectBudgetWarnings(bill.projectId)));
  }
  return { ...result, warnings };
}

/**
 * FRS 27 lists Rejected as a vendor bill status; Section 24 lists REJECT as an
 * audited action with a reason. Available to the verifier and the approver,
 * at any point before approval -- after that, the way out is cancellation.
 */
export async function rejectVendorBill(actingUser, billId, { reason }) {
  const bill = await loadBillForTransition(billId);

  if (!REJECTABLE_STATUSES.includes(bill.status)) {
    throw new AppError(
      409,
      `A ${bill.status} vendor bill cannot be rejected. Rejection applies while a bill is under review ` +
        `(${REJECTABLE_STATUSES.join(", ")}); an approved bill is cancelled instead.`
    );
  }
  assertStatusTransition(bill, "REJECTED");

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, { bill, target: "REJECTED", actingUser, action: "REJECT", comment: reason })
  );

  return getVendorBillOr404(billId, actingUser);
}

/**
 * Rejected -> Draft, so a bill rejected for a fixable error can be corrected
 * and resubmitted. See the STATUS_TRANSITIONS comment for why this exit has to
 * exist: the row cannot be deleted (Section 26 rule 6) and the bill number
 * cannot be reused on a new row (@@unique([vendorId, billNumber])).
 */
export async function reopenVendorBill(actingUser, billId, { comment } = {}) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "DRAFT");

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, {
      bill,
      target: "DRAFT",
      actingUser,
      action: "UPDATE",
      comment: comment ?? "Reopened for correction after rejection.",
      // The previous review is void once the figures can change again --
      // leaving the names attached would misrepresent who checked what.
      extraData: { verifiedById: null, approvedById: null },
    })
  );

  return getVendorBillOr404(billId, actingUser);
}

/**
 * Any non-terminal -> Cancelled, with a mandatory reason (Section 24). The
 * reason is required at the schema level, so by the time this runs it is
 * guaranteed present.
 */
export async function cancelVendorBill(actingUser, billId, { reason }) {
  const bill = await loadBillForTransition(billId);
  assertStatusTransition(bill, "CANCELLED");

  // A cancelled bill must not keep absorbing payments, and a part-paid one
  // needs a refund or debit-note decision that this module does not model.
  const paid = await prisma.vendorPayment.aggregate({
    where: { vendorBillId: billId },
    _sum: { amount: true },
  });
  const amountPaid = round2(num(paid._sum.amount));
  if (amountPaid > 0) {
    throw new AppError(
      409,
      `${amountPaid} has already been paid against this bill, so it cannot be cancelled. ` +
        "Recovering money already sent to a vendor is a debit note, which this module does not model."
    );
  }

  // Unfiled input-tax records for a bill that is no longer a liability would
  // overstate the input tax credit for the period. Records already tied to a
  // filing period are left alone -- Section 26 rule 8 locks those, and undoing
  // them is a debit-note decision, not a cancellation side effect.
  const gstRows = await prisma.gstTransaction.findMany({
    where: { vendorBillId: billId },
    select: {
      id: true,
      gstRate: true,
      taxableAmount: true,
      filingPeriod: { select: { status: true } },
    },
  });
  // Locked means the period has been FILED, not merely that a period exists --
  // see the matching note in invoice.service.cancelInvoice.
  const removable = gstRows.filter((row) => !isPeriodLocked(row.filingPeriod));
  const locked = gstRows.filter((row) => isPeriodLocked(row.filingPeriod));

  await prisma.$transaction(async (tx) => {
    await applyStatusChange(tx, { bill, target: "CANCELLED", actingUser, action: "CANCEL", comment: reason });

    if (removable.length > 0) {
      await tx.gstTransaction.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
      await writeAuditLog(
        {
          entityType: GST_ENTITY_TYPE,
          entityId: billId,
          action: "VOID",
          performedById: actingUser.id,
          previousValue: {
            direction: "INPUT",
            transactions: removable.map((r) => ({
              gstRate: round2(num(r.gstRate)),
              taxableAmount: round2(num(r.taxableAmount)),
            })),
          },
          note: `Removed with cancellation of vendor bill ${bill.billNumber}: ${reason}`,
        },
        tx
      );
    }
  });

  const result = await getVendorBillOr404(billId, actingUser);
  const warnings = [];
  if (locked.length > 0) {
    warnings.push({
      code: "GST_RECORDS_LOCKED",
      message:
        `${locked.length} input-tax record(s) for this bill are in a filing period that has already been ` +
        "filed and were left in place (FRS Section 26, rule 8). Reverse the input tax credit with a GST " +
        "adjustment entry in the current open period.",
    });
  }
  return { ...result, warnings };
}

// ---------------------------------------------------------------------------
// Writes -- payments (FRS 16.3, 20, 29.7)
// ---------------------------------------------------------------------------

/**
 * Records a vendor payment and lets the bill status follow from it.
 *
 * Section 26 rule 9's AP mirror: Paid/Partially Paid are derived from
 * VendorPayment sums, never manually settable -- which is why this is the only
 * function in the module that can produce either, and why it recomputes the sum
 * from the table inside the transaction rather than trusting a running total.
 *
 * FRS 16.2 puts Payment after Approval, so an unapproved bill cannot be paid:
 * that ordering is the whole point of the workflow.
 */
/**
 * `externalTx` (Payout Subsystem Step 2): lets a caller that already owns an
 * open Prisma transaction -- PayoutService's atomic payout-completion flow --
 * run this inside it, so "vendor bill payment recorded" and "Payout marked
 * PROCESSED" commit or roll back together. Default behavior (no `externalTx`)
 * is byte-for-byte unchanged: same reads, same FOR UPDATE lock, same
 * overpayment check, same audit/status-derivation logic, wrapped in its own
 * `prisma.$transaction` exactly as before. When `externalTx` IS supplied, the
 * final `getVendorBillOr404` re-read is skipped (it would read via a
 * different connection than the still-open caller transaction, and so could
 * not see writes this same call just made) -- the caller gets the raw
 * transactional result instead and is responsible for its own post-commit
 * read if it needs a decorated bill.
 */
export async function recordPayment(actingUser, billId, input, externalTx = null) {
  const client = externalTx || prisma;
  const bill = await client.vendorBill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      billNumber: true,
      status: true,
      totalAmount: true,
      currency: true,
      dueDate: true,
      vendorId: true,
    },
  });
  if (!bill) throw new AppError(404, "Vendor bill not found.");

  if (!PAYABLE_STATUSES.includes(bill.status)) {
    throw new AppError(
      409,
      bill.status === "PAID"
        ? "This vendor bill is already fully paid."
        : `A payment can only be recorded against an approved vendor bill. This one is ${bill.status}.`
    );
  }

  const totalAmount = round2(num(bill.totalAmount));

  const run = async (tx) => {
    // Lock the bill row for the life of this transaction before reading the
    // payment sum. A plain SELECT/aggregate takes no lock in Postgres, so
    // without this, two concurrent recordPayment calls for the same bill can
    // both read the same 'before' sum under READ COMMITTED (Postgres's
    // default, and Prisma's default here), both pass the overpayment check
    // below, and both insert -- overpaying the bill. SELECT ... FOR UPDATE
    // makes the second transaction block on this line until the first commits
    // or rolls back; once unblocked, its own next statement (the aggregate)
    // runs on a fresh READ COMMITTED snapshot that includes the first
    // transaction's now-committed payment, so the outstanding balance it
    // checks against is always the true one, not a stale one race-read before
    // either write landed.
    await tx.$queryRaw`SELECT id FROM "VendorBill" WHERE id = ${billId} FOR UPDATE`;

    // Re-read the sum inside the (now locked) transaction so two concurrent
    // payments cannot both pass the overpayment check against the same stale
    // balance -- see the lock above for why this alone was not sufficient.
    const before = await tx.vendorPayment.aggregate({ where: { vendorBillId: billId }, _sum: { amount: true } });
    const paidBefore = round2(num(before._sum.amount));
    const outstandingBefore = round2(totalAmount - paidBefore);

    if (input.amount > outstandingBefore) {
      throw new AppError(
        409,
        `Payment of ${input.amount} exceeds the ${outstandingBefore} outstanding on bill ${bill.billNumber}. ` +
          "Pay the outstanding amount, or ask the vendor for a corrected bill."
      );
    }

    const payment = await tx.vendorPayment.create({
      data: {
        vendorBillId: billId,
        amount: input.amount,
        paymentDate: input.paymentDate,
        method: input.method,
        referenceNo: input.referenceNo ?? null,
        note: input.note ?? null,
      },
      select: PAYMENT_SELECT,
    });

    const paidAfter = round2(paidBefore + input.amount);
    const outstandingAfter = round2(totalAmount - paidAfter);

    // Section 24 names payments as an audited entity in their own right.
    await writeAuditLog(
      {
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: payment.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          vendorBillId: billId,
          billNumber: bill.billNumber,
          vendorId: bill.vendorId,
          amount: round2(input.amount),
          paymentDate: new Date(input.paymentDate).toISOString(),
          method: input.method,
          referenceNo: payment.referenceNo,
          amountPaid: paidAfter,
          outstandingAmount: outstandingAfter,
        },
        note: input.note ?? null,
      },
      tx
    );

    // FRS 16.3 "partial payment" / "payment status".
    const target = outstandingAfter <= 0 ? "PAID" : "PARTIALLY_PAID";
    let statusChanged = false;
    if (bill.status !== target) {
      assertStatusTransition(bill, target);
      await applyStatusChange(tx, {
        bill,
        target,
        actingUser,
        action: "UPDATE",
        comment: `Payment of ${round2(input.amount)} ${bill.currency} recorded (${paidAfter} of ${totalAmount}).`,
      });
      statusChanged = true;
    }

    return { payment, paidAfter, outstandingAfter, target, statusChanged };
  };

  const result = externalTx ? await run(externalTx) : await prisma.$transaction(run);

  const warnings = [];
  if (daysBetween(new Date(), input.paymentDate) > 0) {
    warnings.push({
      code: "PAYMENT_DATE_IN_FUTURE",
      message: "The payment date is in the future; the money has not left the account yet.",
    });
  }
  if (daysBetween(bill.dueDate, input.paymentDate) > 0) {
    warnings.push({
      code: "PAID_AFTER_DUE_DATE",
      message: `This payment is dated ${daysBetween(bill.dueDate, input.paymentDate)} day(s) after the bill's due date.`,
    });
  }

  const payment = { ...result.payment, amount: round2(num(result.payment.amount)) };

  if (externalTx) {
    // Caller (PayoutService) owns a still-open transaction -- see the
    // `externalTx` doc comment above for why a live re-read is unsafe here.
    return { payment, paidAfter: result.paidAfter, outstandingAfter: result.outstandingAfter, target: result.target, statusChanged: result.statusChanged, warnings };
  }

  return {
    payment,
    bill: await getVendorBillOr404(billId, actingUser),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Vendor Payable report (FRS 22 "Vendor Payable | Vendor, date range |
// Super Admin, Finance Admin")
// ---------------------------------------------------------------------------

/**
 * Every unpaid, non-cancelled, non-rejected bill with its payments, reduced to
 * the Section 16.3 derived values. Status is not trusted for the "is it past
 * due" decision -- dueDate is.
 */
async function loadPayables({ vendorId, projectId, from, to, asOf }) {
  const rows = await prisma.vendorBill.findMany({
    where: {
      status: { in: OUTSTANDING_STATUSES },
      ...(vendorId ? { vendorId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(from || to
        ? {
            billDate: {
              ...(from ? { gte: startOfUtcDay(from) } : {}),
              ...(to ? { lte: startOfUtcDay(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true, category: true, currency: true } },
      project: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });

  return rows
    .map((row) => {
      const totalAmount = round2(num(row.totalAmount));
      const amountPaid = round2(row.payments.reduce((s, p) => s + num(p.amount), 0));
      const outstandingAmount = round2(totalAmount - amountPaid);
      const daysPastDue = daysBetween(row.dueDate, asOf);

      return {
        id: row.id,
        billNumber: row.billNumber,
        status: row.status,
        vendor: row.vendor,
        project: row.project,
        currency: row.currency,
        billDate: row.billDate,
        dueDate: row.dueDate,
        totalAmount,
        amountPaid,
        outstandingAmount,
        daysPastDue: daysPastDue > 0 ? daysPastDue : 0,
        isOverdue: outstandingAmount > 0 && daysPastDue > 0,
      };
    })
    // A fully-paid bill whose status has not caught up is not a payable.
    .filter((row) => row.outstandingAmount > 0);
}

export async function getPayableReport({ vendorId, projectId, from, to, asOf }) {
  const asOfDate = startOfUtcDay(asOf || new Date());
  const rows = await loadPayables({ vendorId, projectId, from, to, asOf: asOfDate });

  const byVendor = new Map();
  for (const row of rows) {
    const entry = byVendor.get(row.vendor.id) || {
      vendor: row.vendor,
      billCount: 0,
      totalOutstanding: 0,
      overdueOutstanding: 0,
    };
    entry.billCount += 1;
    entry.totalOutstanding = round2(entry.totalOutstanding + row.outstandingAmount);
    if (row.isOverdue) entry.overdueOutstanding = round2(entry.overdueOutstanding + row.outstandingAmount);
    byVendor.set(row.vendor.id, entry);
  }

  const buckets = AGING_BUCKETS.map((bucket) => {
    const matched = rows.filter((row) => {
      const d = row.daysPastDue;
      if (bucket.max === 0) return d <= 0;
      if (bucket.min !== null && d < bucket.min) return false;
      if (bucket.max !== null && d > bucket.max) return false;
      return d > 0;
    });
    return {
      key: bucket.key,
      label: bucket.label,
      billCount: matched.length,
      amount: round2(matched.reduce((s, r) => s + r.outstandingAmount, 0)),
    };
  });

  return {
    asOf: asOfDate,
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: {
      billCount: rows.length,
      totalOutstanding: round2(rows.reduce((s, r) => s + r.outstandingAmount, 0)),
      overdueCount: rows.filter((r) => r.isOverdue).length,
      overdueOutstanding: round2(rows.filter((r) => r.isOverdue).reduce((s, r) => s + r.outstandingAmount, 0)),
    },
    byVendor: [...byVendor.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding),
    buckets,
    bills: rows,
    // Mixed-currency bills would make these sums meaningless; say so rather
    // than presenting a total that silently adds INR to USD.
    caveats: buildCurrencyCaveats(rows),
  };
}

