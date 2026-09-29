// Invoicing & Accounts Receivable (FRS Sections 14, 15, 20, 29.6, 31).
//
// What lives here: invoice number generation, line-item arithmetic, the
// Section 14.2 status lifecycle, the GST split, payment recording, and the
// Section 15 AR derivations. Permission gating does NOT live here -- the
// CREATE_INVOICE / APPROVE_INVOICE / RECORD_CLIENT_PAYMENT codes are applied at
// the route layer via requirePermission (which carries the Section 30 Super
// Admin bypass), exactly as clients, projects and expenses do.
//
// The one authorization rule that IS here is maker-checker (Section 26 rule 5):
// it compares the approver against the invoice's own createdById, so it needs
// the record and cannot be expressed as a permission code.
//
// Nothing is hard-deleted (Section 26 rule 6 / FR-18). An invoice is retired by
// moving it to CANCELLED with a reason.

import path from "path";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { resolveUploadPath } from "../../middleware/upload.middleware.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";
import { recordApprovalStep, listApprovalSteps } from "../../utils/approvalHistory.js";
// The CGST/SGST/IGST split is shared with the vendor-bills (INPUT tax) side --
// see utils/gst.js for why the two must not be separate implementations.
import { resolveGstTreatment as resolveGstTreatmentFor, buildGstTransactions } from "../../utils/gst.js";
import { resolveFilingPeriod, formatPeriodLabel, isPeriodLocked } from "../../utils/gstPeriod.js";
import { assertClientExists } from "../clients/client.service.js";
import { assertProjectAssignable } from "../projects/project.service.js";
import { buildCurrencyCaveats } from "../../utils/currency.js";

/** Place of supply for an OUTPUT-tax document: the counterparty is the client. */
const resolveGstTreatment = (clientGstin) => resolveGstTreatmentFor(clientGstin, "CLIENT_GSTIN_MISSING");

const ENTITY_TYPE = "Invoice";
const PAYMENT_ENTITY_TYPE = "ClientPayment";
const GST_ENTITY_TYPE = "GstTransaction";
const DOCUMENT_SUBFOLDER = "invoices";

// Audit snapshots carry changed fields only (Section 24).
const INVOICE_FIELDS = [
  "clientId",
  "projectId",
  "milestoneId",
  "invoiceDate",
  "dueDate",
  "billingPeriodStart",
  "billingPeriodEnd",
  "paymentTerms",
  "currency",
  "notes",
  "totalAmount",
  "status",
];

/**
 * FRS Section 14.2, as a table rather than prose.
 *
 * PARTIALLY_PAID and PAID are reachable only from recordPayment -- Section 26
 * rule 9 makes them "always system-derived from ClientPayment sums, never
 * manually settable", so no endpoint in this module accepts them as a target.
 * OVERDUE is likewise only reachable from the dated sweep.
 */
const STATUS_TRANSITIONS = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"],
  PARTIALLY_PAID: ["PAID", "OVERDUE", "CANCELLED"],
  OVERDUE: ["PARTIALLY_PAID", "PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

// "Paid → terminal, no further transitions; corrections happen via Credit Note
// (Phase 2)" and cancelled is likewise final (Section 14.2).
const TERMINAL_STATUSES = ["PAID", "CANCELLED"];

// An invoice is editable only while it is a DRAFT. Once it has been submitted,
// changing the figures underneath the approver would defeat the approval, and
// once it is SENT the client has already seen it.
const EDITABLE_STATUSES = ["DRAFT"];

// The point from which the client owes money -- "Approved → Sent ... triggers
// AR tracking start" (Section 14.2). Payments can only land on an invoice the
// client has actually been given.
// Exported (Payment Gateway Stage 5): the online-payment-initiation flow
// needs the exact same "is this invoice payable at all" rule as the manual
// recordPayment path below -- reused, not redefined, so the two can never
// drift apart on what counts as payable.
export const PAYABLE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

// What counts as a receivable for Section 15 / the AR reports. CANCELLED is
// excluded (nobody owes it) and so is PAID (nothing left).
const OUTSTANDING_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

// FRS 15.3 / Section 22 "Invoice Aging", 🟡 standard buckets.
const AGING_BUCKETS = [
  { key: "current", label: "Not yet due", min: null, max: 0 },
  { key: "d0_30", label: "0-30 days", min: 1, max: 30 },
  { key: "d31_60", label: "31-60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61-90 days", min: 61, max: 90 },
  { key: "d90_plus", label: "90+ days", min: 91, max: null },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CLIENT_SELECT = { id: true, name: true, status: true, currency: true, gstin: true, paymentTerms: true };
const PROJECT_SELECT = { id: true, name: true, status: true, clientId: true, contractValue: true };
const MILESTONE_SELECT = { id: true, name: true, status: true, amount: true, projectId: true, dueDate: true };
const LINE_ITEM_SELECT = {
  id: true,
  description: true,
  quantity: true,
  rate: true,
  taxRate: true,
  discount: true,
  lineTotal: true,
};
const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paymentDate: true,
  method: true,
  referenceNo: true,
  note: true,
  recordedAt: true,
};
const DOCUMENT_SELECT = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
  uploadedById: true,
};

const INVOICE_INCLUDE = {
  client: { select: CLIENT_SELECT },
  project: { select: PROJECT_SELECT },
  milestone: { select: MILESTONE_SELECT },
  lineItems: { select: LINE_ITEM_SELECT },
  payments: { select: PAYMENT_SELECT, orderBy: { paymentDate: "asc" } },
  documents: { select: DOCUMENT_SELECT, orderBy: { uploadedAt: "asc" } },
};

// ---------------------------------------------------------------------------
// Small numeric / date helpers -- Prisma hands back Decimal, not Number.
// ---------------------------------------------------------------------------

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Dates are floored to whole UTC days before anything is compared or counted.
 * "Overdue" and the aging buckets are day-grained concepts: without this an
 * invoice due today reads as overdue by a fraction of a day, and two calls to
 * the aging report hours apart disagree about which bucket a row is in.
 */
function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(from, to) {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Line-item arithmetic (FRS 14.1)
// ---------------------------------------------------------------------------

/**
 * `lineTotal` is the TAXABLE value of the line -- quantity x rate less the
 * line's discount, before tax. Tax is then added once at invoice level to reach
 * `totalAmount`, the "overall total amount" of Section 14.1 that the client
 * actually pays.
 *
 * Storing lineTotal tax-exclusive is what lets it be used directly as
 * GstTransaction.taxableAmount (Section 17.4) without having to unwind tax back
 * out of it, and keeps a discount unambiguously pre-tax, as GST law requires.
 */
function computeLineTotal(item) {
  const gross = round2(num(item.quantity) * num(item.rate));
  const lineTotal = round2(gross - num(item.discount));
  if (lineTotal < 0) {
    throw new AppError(
      400,
      `Discount on "${item.description}" (${num(item.discount)}) exceeds the line value (${gross}).`
    );
  }
  return lineTotal;
}

/**
 * Rolls a set of line items up into the figures the invoice header carries.
 * Tax is summed per line and only then rounded into the header, so a set of
 * lines at mixed GST rates totals to the same number the per-rate GST
 * transactions do.
 */
function computeTotals(items) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;

  const priced = items.map((item) => {
    const lineTotal = computeLineTotal(item);
    const taxRate = num(item.taxRate);
    const taxAmount = round2((lineTotal * taxRate) / 100);

    subtotal = round2(subtotal + lineTotal);
    discountTotal = round2(discountTotal + num(item.discount));
    taxTotal = round2(taxTotal + taxAmount);

    return {
      description: item.description,
      quantity: round2(num(item.quantity)),
      rate: round2(num(item.rate)),
      taxRate: round2(taxRate),
      discount: round2(num(item.discount)),
      lineTotal,
      taxAmount,
    };
  });

  return {
    lineItems: priced,
    subtotal,
    discountTotal,
    taxTotal,
    totalAmount: round2(subtotal + taxTotal),
  };
}

// ---------------------------------------------------------------------------
// Invoice numbering (FRS 14.1)
// ---------------------------------------------------------------------------

const INVOICE_NUMBER_PREFIX = "INV";

/**
 * Sequential per calendar year of the invoice date: INV-2026-0001.
 *
 * Generated server-side rather than accepted from the caller so the @unique
 * column cannot be collided with, and so the sequence has no caller-created
 * gaps -- an auditor reading a run of invoice numbers is entitled to assume a
 * missing one means something. `tx` is the surrounding transaction, and the
 * caller retries on a unique violation if two creates race (see createInvoice).
 */
async function nextInvoiceNumber(tx, invoiceDate) {
  const year = new Date(invoiceDate).getUTCFullYear();
  const prefix = `${INVOICE_NUMBER_PREFIX}-${year}-`;

  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  const lastSeq = latest ? parseInt(latest.invoiceNumber.slice(prefix.length), 10) : 0;
  const next = (Number.isNaN(lastSeq) ? 0 : lastSeq) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Visibility (FRS 31 "Invoices: Finance/Admin")
// ---------------------------------------------------------------------------

/**
 * Section 29.6 names a permission for every invoice WRITE but never defines a
 * read gate; Section 31 answers it instead -- the Invoices and Invoice Detail
 * pages are "Finance/Admin". So anyone holding a permission that lets them act
 * on invoices at all, plus Finance's reporting override, can read them.
 *
 * Unlike clients, this is not opened to every authenticated user: an invoice
 * carries contract revenue per client and project.
 */
export const INVOICE_READ_PERMISSIONS = [
  "CREATE_INVOICE",
  "APPROVE_INVOICE",
  "RECORD_CLIENT_PAYMENT",
  "VIEW_FINANCIAL_REPORTS",
];

export function canSeeInvoices(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return INVOICE_READ_PERMISSIONS.some((code) => codes.includes(code));
}

// ---------------------------------------------------------------------------
// Relationship validation (server-side, per FRS 8.3 / 32)
// ---------------------------------------------------------------------------

/**
 * Validates the client/project/milestone triangle in one place, because the
 * failure that matters is not "does this id exist" but "do these three ids
 * belong together". An invoice addressed to client A against a project owned by
 * client B is a billing error that reconciles to nothing.
 *
 * `requireActiveClient` is false when re-validating an existing invoice, so a
 * client going INACTIVE later never freezes an in-flight invoice.
 */
async function resolveRelations({ clientId, projectId, milestoneId }, { requireActiveClient = true } = {}) {
  const client = await assertClientExists(clientId);
  if (requireActiveClient && client.status === "INACTIVE") {
    throw new AppError(400, `Client "${client.name}" is inactive; reactivate it before raising a new invoice.`);
  }

  let project = null;
  if (projectId) {
    // Reuses the projects module's own guard rather than re-deriving the rule,
    // so a cancelled project is refused here exactly as it is for expenses.
    await assertProjectAssignable(projectId);
    project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (project.clientId !== clientId) {
      throw new AppError(400, `Project "${project.name}" belongs to a different client than this invoice.`);
    }
  }

  let milestone = null;
  if (milestoneId) {
    // FRS 13.3 ties a milestone invoice to the delivery it bills, so a
    // milestone without its project is meaningless rather than merely untidy.
    if (!projectId) {
      throw new AppError(400, "A milestone can only be invoiced together with the project it belongs to.");
    }
    milestone = await prisma.projectMilestone.findUnique({
      where: { id: milestoneId },
      select: MILESTONE_SELECT,
    });
    if (!milestone) throw new AppError(400, "The specified milestone does not exist.");
    if (milestone.projectId !== projectId) {
      throw new AppError(400, `Milestone "${milestone.name}" belongs to a different project.`);
    }
    if (milestone.status === "CANCELLED") {
      throw new AppError(400, `Milestone "${milestone.name}" is cancelled and cannot be invoiced.`);
    }
  }

  return { client, project, milestone };
}

// ---------------------------------------------------------------------------
// Warnings (non-blocking) -- the "warn, don't block" shape the expenses and
// clients modules already use for judgement calls the FRS does not forbid.
// ---------------------------------------------------------------------------

async function buildInvoiceWarnings({ client, project, milestone, totals, treatment, invoiceId = null }) {
  const warnings = [];

  if (!treatment.applicable && totals.taxTotal > 0) {
    warnings.push(
      treatment.reason === "COMPANY_GSTIN_NOT_CONFIGURED"
        ? {
            code: "GST_REGISTRATION_NOT_CONFIGURED",
            message:
              "COMPANY_GSTIN is not set, so no CGST/SGST/IGST breakdown was recorded for this invoice. " +
              "The invoice total still includes tax. Set COMPANY_GSTIN and re-send to record the split.",
          }
        : {
            code: "CLIENT_GSTIN_MISSING",
            message: `Client "${client.name}" has no GSTIN on record, so the place of supply could not be determined and no CGST/SGST/IGST breakdown was recorded.`,
          }
    );
  }

  if (client.status !== "ACTIVE") {
    warnings.push({
      code: "CLIENT_NOT_ACTIVE",
      message: `Client "${client.name}" is ${client.status}.`,
    });
  }

  if (client.currency && totals.currency && client.currency !== totals.currency) {
    warnings.push({
      code: "CURRENCY_MISMATCH",
      message: `This invoice is in ${totals.currency} but client "${client.name}" is set up in ${client.currency}.`,
    });
  }

  if (milestone) {
    // FRS 13.3: "each invoiced on completion".
    if (milestone.status !== "COMPLETED") {
      warnings.push({
        code: "MILESTONE_NOT_COMPLETED",
        message: `Milestone "${milestone.name}" is ${milestone.status}, not COMPLETED.`,
      });
    }

    // Nothing in the schema stops a milestone being billed twice, and a
    // duplicate is a real, expensive mistake -- so it is surfaced rather than
    // silently allowed. It is a warning, not a 409, because a legitimate
    // re-invoice after a cancellation exists.
    const others = await prisma.invoice.findMany({
      where: {
        milestoneId: milestone.id,
        status: { not: "CANCELLED" },
        ...(invoiceId ? { id: { not: invoiceId } } : {}),
      },
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
    });
    if (others.length > 0) {
      warnings.push({
        code: "MILESTONE_ALREADY_INVOICED",
        message: `Milestone "${milestone.name}" is already billed on ${others.length} other invoice(s).`,
        invoices: others.map((i) => ({ ...i, totalAmount: round2(num(i.totalAmount)) })),
      });
    }

    if (milestone.amount != null && round2(num(milestone.amount)) !== totals.totalAmount) {
      warnings.push({
        code: "MILESTONE_AMOUNT_MISMATCH",
        message: `Invoice total ${totals.totalAmount} does not match milestone "${milestone.name}" amount ${round2(num(milestone.amount))}.`,
      });
    }
  }

  if (project && project.contractValue != null) {
    // "Have we now billed more than the contract is worth?" -- cheap to check
    // here and expensive to discover at year end.
    const billedAgg = await prisma.invoice.aggregate({
      where: {
        projectId: project.id,
        status: { not: "CANCELLED" },
        ...(invoiceId ? { id: { not: invoiceId } } : {}),
      },
      _sum: { totalAmount: true },
    });
    const billed = round2(num(billedAgg._sum.totalAmount) + totals.totalAmount);
    const contract = round2(num(project.contractValue));
    if (billed > contract) {
      warnings.push({
        code: "CONTRACT_VALUE_EXCEEDED",
        message: `Billing this invoice brings total invoiced on "${project.name}" to ${billed}, above its contract value of ${contract}.`,
        billedTotal: billed,
        contractValue: contract,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Presentation -- the derived AR figures of Section 15.2
// ---------------------------------------------------------------------------

/**
 * Section 15.2, verbatim:
 *   Amount Received  = sum of all ClientPayment rows linked to the invoice
 *   Remaining Amount = Invoice Total - Amount Received
 *   Overdue          = Remaining Amount > 0 AND today > Invoice Due Date
 *
 * `isOverdue` is computed on every read rather than trusted from the status
 * column, so an invoice is never reported as current merely because the sweep
 * (see syncOverdueInvoices) has not run yet.
 */
function decorateInvoice(invoice, { asOf = new Date() } = {}) {
  const payments = invoice.payments || [];
  const lineItems = (invoice.lineItems || []).map((li) => ({
    ...li,
    quantity: round2(num(li.quantity)),
    rate: round2(num(li.rate)),
    taxRate: round2(num(li.taxRate)),
    discount: round2(num(li.discount)),
    lineTotal: round2(num(li.lineTotal)),
    taxAmount: round2((num(li.lineTotal) * num(li.taxRate)) / 100),
  }));

  const subtotal = round2(lineItems.reduce((s, li) => s + li.lineTotal, 0));
  const discountTotal = round2(lineItems.reduce((s, li) => s + li.discount, 0));
  const taxTotal = round2(lineItems.reduce((s, li) => s + li.taxAmount, 0));

  const totalAmount = round2(num(invoice.totalAmount));
  const amountReceived = round2(payments.reduce((s, p) => s + num(p.amount), 0));
  const remainingAmount = round2(totalAmount - amountReceived);

  const settled = TERMINAL_STATUSES.includes(invoice.status);
  const daysPastDue = daysBetween(invoice.dueDate, asOf);
  const isOverdue = !settled && remainingAmount > 0 && daysPastDue > 0;

  return {
    ...invoice,
    totalAmount,
    lineItems,
    payments: payments.map((p) => ({ ...p, amount: round2(num(p.amount)) })),
    project: invoice.project
      ? {
          ...invoice.project,
          contractValue: invoice.project.contractValue == null ? null : round2(num(invoice.project.contractValue)),
        }
      : invoice.project,
    milestone: invoice.milestone
      ? { ...invoice.milestone, amount: invoice.milestone.amount == null ? null : round2(num(invoice.milestone.amount)) }
      : invoice.milestone,
    totals: { subtotal, discountTotal, taxTotal, totalAmount },
    ar: {
      amountReceived,
      remainingAmount,
      isOverdue,
      daysPastDue: daysPastDue > 0 ? daysPastDue : 0,
      paymentCount: payments.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listInvoices({
  status,
  clientId,
  projectId,
  milestoneId,
  from,
  to,
  outstandingOnly,
  overdueOnly,
  search,
  skip,
  take,
}) {
  const filters = [];

  if (status) filters.push({ status });
  if (clientId) filters.push({ clientId });
  if (projectId) filters.push({ projectId });
  if (milestoneId) filters.push({ milestoneId });
  if (from) filters.push({ invoiceDate: { gte: startOfUtcDay(from) } });
  if (to) filters.push({ invoiceDate: { lte: startOfUtcDay(to) } });
  if (outstandingOnly) filters.push({ status: { in: OUTSTANDING_STATUSES } });
  if (overdueOnly) {
    // Status-independent, so it stays correct between sweeps.
    filters.push({ status: { in: OUTSTANDING_STATUSES }, dueDate: { lt: startOfUtcDay(new Date()) } });
  }
  if (search) {
    filters.push({
      OR: [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { project: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where = filters.length > 0 ? { AND: filters } : {};

  const [rows, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take,
      orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
      include: {
        client: { select: CLIENT_SELECT },
        project: { select: PROJECT_SELECT },
        milestone: { select: MILESTONE_SELECT },
        lineItems: { select: LINE_ITEM_SELECT },
        payments: { select: { amount: true } },
        _count: { select: { lineItems: true, payments: true, documents: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return { rows: rows.map((row) => decorateInvoice(row)), totalCount };
}

export async function getInvoiceOr404(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) throw new AppError(404, "Invoice not found.");

  const decorated = decorateInvoice(invoice);

  const [gstTransactions, approvalHistory] = await Promise.all([
    prisma.gstTransaction.findMany({
      where: { invoiceId },
      select: {
        id: true,
        gstRate: true,
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        filingPeriodId: true,
      },
      orderBy: { gstRate: "asc" },
    }),
    // FRS 31 "Invoice Detail ... status timeline".
    listApprovalSteps(ENTITY_TYPE, invoiceId),
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
      totalTax: round2(
        gstTransactions.reduce((s, t) => s + num(t.cgstAmount) + num(t.sgstAmount) + num(t.igstAmount), 0)
      ),
    },
    approvalHistory,
  };
}

/** FRS 15.1 "payment history". Scoped to the invoice in the URL. */
export async function listPayments(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, totalAmount: true, currency: true, status: true },
  });
  if (!invoice) throw new AppError(404, "Invoice not found.");

  const payments = await prisma.clientPayment.findMany({
    where: { invoiceId },
    select: PAYMENT_SELECT,
    orderBy: { paymentDate: "asc" },
  });

  const totalAmount = round2(num(invoice.totalAmount));
  const amountReceived = round2(payments.reduce((s, p) => s + num(p.amount), 0));

  return {
    invoice: { ...invoice, totalAmount },
    payments: payments.map((p) => ({ ...p, amount: round2(num(p.amount)) })),
    amountReceived,
    remainingAmount: round2(totalAmount - amountReceived),
  };
}

/**
 * Guard for any module that needs to reference an invoice (the GST module's
 * manual adjustments, a future credit note). Exported now so those reuse the
 * rule instead of re-deriving it, mirroring assertClientExists /
 * assertProjectAssignable. Nothing outside this module calls it yet.
 */
export async function assertInvoiceExists(invoiceId) {
  if (!invoiceId) return null;
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, status: true, clientId: true, projectId: true },
  });
  if (!invoice) throw new AppError(400, "The specified invoice does not exist.");
  return invoice;
}

// ---------------------------------------------------------------------------
// Writes -- create / edit
// ---------------------------------------------------------------------------

export async function createInvoice(actingUser, input) {
  const { client, project, milestone } = await resolveRelations(input);
  const totals = computeTotals(input.lineItems);
  const currency = input.currency || client.currency || "INR";
  const treatment = resolveGstTreatment(client.gstin);

  // Retry only the number allocation: two concurrent creates can pick the same
  // sequence, and the @unique column is what catches it. Everything inside the
  // transaction is idempotent to re-run.
  let invoice = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      invoice = await prisma.$transaction(async (tx) => {
        const invoiceNumber = await nextInvoiceNumber(tx, input.invoiceDate);

        const row = await tx.invoice.create({
          data: {
            invoiceNumber,
            clientId: input.clientId,
            projectId: input.projectId ?? null,
            milestoneId: input.milestoneId ?? null,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate,
            billingPeriodStart: input.billingPeriodStart ?? null,
            billingPeriodEnd: input.billingPeriodEnd ?? null,
            // Snapshotted off the client when the caller does not state terms,
            // so the invoice records what was promised at the time.
            paymentTerms: input.paymentTerms ?? client.paymentTerms ?? null,
            currency,
            notes: input.notes ?? null,
            totalAmount: totals.totalAmount,
            createdById: actingUser.id,
            // status omitted so the schema default DRAFT applies.
            lineItems: {
              create: totals.lineItems.map((li) => ({
                description: li.description,
                quantity: li.quantity,
                rate: li.rate,
                taxRate: li.taxRate,
                discount: li.discount,
                lineTotal: li.lineTotal,
              })),
            },
          },
        });

        // Section 26 rule 7 / Section 24: the audit row commits with the change
        // it records, never separately.
        await writeAuditLog(
          {
            entityType: ENTITY_TYPE,
            entityId: row.id,
            action: "CREATE",
            performedById: actingUser.id,
            newValue: {
              invoiceNumber: row.invoiceNumber,
              clientId: row.clientId,
              projectId: row.projectId,
              milestoneId: row.milestoneId,
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
      break;
    } catch (err) {
      const collision = err.code === "P2002" && String(err.meta?.target || "").includes("invoiceNumber");
      if (!collision || attempt === 4) throw err;
    }
  }

  const warnings = await buildInvoiceWarnings({
    client,
    project,
    milestone,
    totals: { ...totals, currency },
    treatment,
    invoiceId: invoice.id,
  });

  return { ...(await getInvoiceOr404(invoice.id)), warnings };
}

export async function updateInvoice(actingUser, invoiceId, input) {
  const existing = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: { select: LINE_ITEM_SELECT } },
  });
  if (!existing) throw new AppError(404, "Invoice not found.");

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new AppError(
      409,
      `Only a DRAFT invoice can be edited; this one is ${existing.status}. ` +
        "Cancel it and raise a replacement if the figures are wrong."
    );
  }

  // Validate the triangle against the MERGED state, not just the supplied
  // keys: changing only clientId must still be checked against the project
  // that is already on the invoice.
  const merged = {
    clientId: input.clientId ?? existing.clientId,
    projectId: input.projectId === undefined ? existing.projectId : input.projectId,
    milestoneId: input.milestoneId === undefined ? existing.milestoneId : input.milestoneId,
  };
  const { client, project, milestone } = await resolveRelations(merged);

  // Same for the date pair -- a PATCH of dueDate alone still has to sit after
  // the invoiceDate already stored.
  const invoiceDate = input.invoiceDate ?? existing.invoiceDate;
  const dueDate = input.dueDate ?? existing.dueDate;
  if (new Date(dueDate) < new Date(invoiceDate)) {
    throw new AppError(400, "dueDate must be on or after invoiceDate.");
  }
  const periodStart = input.billingPeriodStart === undefined ? existing.billingPeriodStart : input.billingPeriodStart;
  const periodEnd = input.billingPeriodEnd === undefined ? existing.billingPeriodEnd : input.billingPeriodEnd;
  if (periodStart && periodEnd && new Date(periodEnd) < new Date(periodStart)) {
    throw new AppError(400, "billingPeriodEnd must be on or after billingPeriodStart.");
  }

  const totals = input.lineItems ? computeTotals(input.lineItems) : computeTotals(existing.lineItems);
  const currency = input.currency ?? existing.currency;

  await prisma.$transaction(async (tx) => {
    if (input.lineItems) {
      // Line items are replaced as a set. This is an edit of a DRAFT that has
      // never been issued -- not a deletion of an issued financial record --
      // and the before/after totals are captured in the audit entry below,
      // which is what Section 26 rule 6 is protecting.
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
      await tx.invoiceLineItem.createMany({
        data: totals.lineItems.map((li) => ({
          invoiceId,
          description: li.description,
          quantity: li.quantity,
          rate: li.rate,
          taxRate: li.taxRate,
          discount: li.discount,
          lineTotal: li.lineTotal,
        })),
      });
    }

    const row = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
        ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.billingPeriodStart !== undefined ? { billingPeriodStart: input.billingPeriodStart } : {}),
        ...(input.billingPeriodEnd !== undefined ? { billingPeriodEnd: input.billingPeriodEnd } : {}),
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
      INVOICE_FIELDS
    );
    if (input.lineItems) {
      previousValue.lineItemCount = existing.lineItems.length;
      newValue.lineItemCount = totals.lineItems.length;
    }

    if (changed || input.lineItems) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: invoiceId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }
  });

  const warnings = await buildInvoiceWarnings({
    client,
    project,
    milestone,
    totals: { ...totals, currency },
    treatment: resolveGstTreatment(client.gstin),
    invoiceId,
  });

  return { ...(await getInvoiceOr404(invoiceId)), warnings };
}

/** Dates/Decimals flattened so the audit diff doesn't report unchanged fields. */
function normaliseForDiff(row) {
  return {
    ...row,
    invoiceDate: row.invoiceDate ? new Date(row.invoiceDate).toISOString() : null,
    dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
    billingPeriodStart: row.billingPeriodStart ? new Date(row.billingPeriodStart).toISOString() : null,
    billingPeriodEnd: row.billingPeriodEnd ? new Date(row.billingPeriodEnd).toISOString() : null,
    totalAmount: row.totalAmount == null ? null : round2(num(row.totalAmount)),
  };
}

// ---------------------------------------------------------------------------
// Writes -- the Section 14.2 lifecycle
// ---------------------------------------------------------------------------

/**
 * The single source of truth for the Section 14.2 transition table. Every
 * lifecycle endpoint and the payment/overdue paths run through it, so no route
 * can put an invoice into a state another route would refuse.
 */
function assertStatusTransition(existing, target) {
  if (existing.status === target) {
    throw new AppError(409, `Invoice is already ${target}.`);
  }
  const allowed = STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(target)) {
    throw new AppError(
      409,
      allowed.length === 0
        ? `${existing.status} is a terminal status; no further transitions are allowed.`
        : `Cannot move a ${existing.status} invoice to ${target}. Allowed: ${allowed.join(", ")}.`
    );
  }
}

/**
 * Applies a status change plus its two mandatory trail entries: the AuditLog
 * row (Section 24 / rule 7) and the ApprovalStep row that Section 31's "status
 * timeline" reads back. Always called inside the caller's transaction.
 */
async function applyStatusChange(tx, { invoice, target, actingUser, action, comment = null, extraData = {} }) {
  const row = await tx.invoice.update({
    where: { id: invoice.id },
    data: { status: target, ...extraData },
  });

  await writeAuditLog(
    {
      entityType: ENTITY_TYPE,
      entityId: invoice.id,
      action,
      performedById: actingUser.id,
      previousValue: { status: invoice.status },
      newValue: { status: target, ...extraData },
      note: comment,
    },
    tx
  );

  await recordApprovalStep(
    {
      entityType: ENTITY_TYPE,
      entityId: invoice.id,
      actorUserId: actingUser.id,
      fromStatus: invoice.status,
      toStatus: target,
      comment,
    },
    tx
  );

  return row;
}

async function loadInvoiceForTransition(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: { select: LINE_ITEM_SELECT }, client: { select: CLIENT_SELECT } },
  });
  if (!invoice) throw new AppError(404, "Invoice not found.");
  return invoice;
}

/**
 * FRS 14.2 "Draft → Pending Approval | Creator (Admin/Finance) | Requires all
 * mandatory fields filled". The field check is real, not decorative: an invoice
 * with no lines or a zero total has nothing to approve.
 */
export async function submitInvoice(actingUser, invoiceId, { comment } = {}) {
  const invoice = await loadInvoiceForTransition(invoiceId);
  assertStatusTransition(invoice, "PENDING_APPROVAL");

  if (invoice.lineItems.length === 0) {
    throw new AppError(409, "An invoice needs at least one line item before it can be submitted for approval.");
  }
  if (round2(num(invoice.totalAmount)) <= 0) {
    throw new AppError(409, "An invoice with a zero total cannot be submitted for approval.");
  }

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, { invoice, target: "PENDING_APPROVAL", actingUser, action: "UPDATE", comment })
  );

  return getInvoiceOr404(invoiceId);
}

/**
 * FRS 14.2 / Section 26 rule 5: the approver "must differ from creator".
 *
 * Enforced for everyone, including SUPER_ADMIN. The Section 30 bypass inside
 * requirePermission answers "may this person approve invoices at all"; it is
 * not an exemption from segregation of duties, and a self-approval the CEO
 * waved through is exactly the entry an auditor asks about. The client's stated
 * plan is to have a second Finance user for this.
 */
export async function approveInvoice(actingUser, invoiceId, { comment } = {}) {
  const invoice = await loadInvoiceForTransition(invoiceId);
  assertStatusTransition(invoice, "APPROVED");

  if (invoice.createdById === actingUser.id) {
    throw new AppError(
      409,
      "You created this invoice, so you cannot approve it. Invoice approval must be performed by a different " +
        "user holding APPROVE_INVOICE (FRS Section 26, rule 5)."
    );
  }

  await prisma.$transaction((tx) =>
    applyStatusChange(tx, {
      invoice,
      target: "APPROVED",
      actingUser,
      action: "APPROVE",
      comment,
      extraData: { approvedById: actingUser.id },
    })
  );

  return getInvoiceOr404(invoiceId);
}

/**
 * FRS 14.2 "Approved → Sent ... Marks the point the client has been
 * emailed/shown the invoice; triggers AR tracking start".
 *
 * Section 38 Q40 confirmed email can wait, so this records the fact of sending
 * rather than performing it -- no mail is dispatched and none is implied.
 *
 * This is also the point the GST records are written: a draft that is never
 * issued is not a tax event, but an issued invoice is (Section 17.3, "GST
 * records ... auto-created from invoices").
 */
export async function sendInvoice(actingUser, invoiceId, { comment } = {}) {
  const invoice = await loadInvoiceForTransition(invoiceId);
  assertStatusTransition(invoice, "SENT");

  const treatment = resolveGstTreatment(invoice.client.gstin);
  const priced = invoice.lineItems.map((li) => ({
    taxRate: round2(num(li.taxRate)),
    lineTotal: round2(num(li.lineTotal)),
    taxAmount: round2((num(li.lineTotal) * num(li.taxRate)) / 100),
  }));
  const gstRows = buildGstTransactions(priced, treatment);

  // FRS 17.4 "tax period (month/year)". The invoice date is the tax point, so
  // that is the month the output tax belongs to. Resolved inside the
  // transaction below rather than before it, so the filing period, the GST rows
  // and the status change all commit or roll back together.
  let periodOutcome = null;

  await prisma.$transaction(async (tx) => {
    await applyStatusChange(tx, { invoice, target: "SENT", actingUser, action: "UPDATE", comment });

    if (gstRows.length > 0) {
      periodOutcome = await resolveFilingPeriod(invoice.invoiceDate, tx);
      await tx.gstTransaction.createMany({
        data: gstRows.map((row) => ({
          direction: "OUTPUT", // money in -> output tax (FRS 17.4 input/output flag)
          invoiceId,
          filingPeriodId: periodOutcome.period.id,
          documentDate: invoice.invoiceDate,
          ...row,
        })),
      });

      await writeAuditLog(
        {
          entityType: GST_ENTITY_TYPE,
          entityId: invoiceId,
          action: "CREATE",
          performedById: actingUser.id,
          newValue: {
            invoiceNumber: invoice.invoiceNumber,
            placeOfSupply: treatment.interState ? "INTER_STATE" : "INTRA_STATE",
            filingPeriod: formatPeriodLabel(periodOutcome.period),
            transactions: gstRows,
          },
        },
        tx
      );
    }
  });

  const result = await getInvoiceOr404(invoiceId);
  const warnings = [];
  if (!treatment.applicable && round2(num(invoice.totalAmount)) > 0 && priced.some((p) => p.taxAmount > 0)) {
    warnings.push(
      treatment.reason === "COMPANY_GSTIN_NOT_CONFIGURED"
        ? {
            code: "GST_REGISTRATION_NOT_CONFIGURED",
            message:
              "Invoice sent, but COMPANY_GSTIN is not set so no CGST/SGST/IGST records were created for it. " +
              "Set COMPANY_GSTIN before the tax period is prepared.",
          }
        : {
            code: "CLIENT_GSTIN_MISSING",
            message:
              "Invoice sent, but the client has no GSTIN so the place of supply could not be determined and no " +
              "CGST/SGST/IGST records were created for it.",
          }
    );
  }
  // FRS Section 26 rule 8 makes a filed period read-only, so output tax for an
  // invoice backdated into one cannot be added there. It goes into the next
  // open period instead -- losing it would understate the liability -- and the
  // sender is told, because the two returns will not tie back to invoice dates.
  if (periodOutcome && periodOutcome.rolledForward) {
    warnings.push({
      code: "GST_PERIOD_ROLLED_FORWARD",
      message:
        `This invoice is dated in ${periodOutcome.naturalPeriodLabel}, which has already been filed. Its ` +
        `output tax has been recorded in ${formatPeriodLabel(periodOutcome.period)} instead ` +
        "(FRS Section 26, rule 8).",
    });
  }
  return { ...result, warnings };
}

/**
 * FRS 14.2: "Any non-terminal → Cancelled | Admin/Finance with permission |
 * Requires reason; audit-logged." The reason is mandatory at the schema level,
 * so by the time this runs it is guaranteed present.
 */
export async function cancelInvoice(actingUser, invoiceId, { reason }) {
  const invoice = await loadInvoiceForTransition(invoiceId);
  assertStatusTransition(invoice, "CANCELLED");

  // A cancelled invoice must not keep collecting money, and a part-paid one
  // needs a refund or credit note decision that this module does not model.
  const received = await prisma.clientPayment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  const amountReceived = round2(num(received._sum.amount));
  if (amountReceived > 0) {
    throw new AppError(
      409,
      `${amountReceived} has already been received against this invoice, so it cannot be cancelled. ` +
        "Corrections to a part-paid invoice need a credit note (FRS Section 14.2, Phase 2)."
    );
  }

  // Unfiled GST records for an invoice that no longer exists as a receivable
  // would overstate output tax for the period. Records already tied to a
  // filing period are left alone -- Section 26 rule 8 locks those, and undoing
  // them is a credit-note decision, not a cancellation side effect.
  const gstRows = await prisma.gstTransaction.findMany({
    where: { invoiceId },
    select: {
      id: true,
      gstRate: true,
      taxableAmount: true,
      filingPeriod: { select: { status: true } },
    },
  });
  // Locked means the period has been FILED, not merely that a period exists.
  // Every GST row now gets a period the moment it is written, so the older test
  // (filingPeriodId == null) would have found nothing removable and left a
  // cancelled invoice overstating output tax in an open, unfiled month.
  const removable = gstRows.filter((row) => !isPeriodLocked(row.filingPeriod));
  const locked = gstRows.filter((row) => isPeriodLocked(row.filingPeriod));

  await prisma.$transaction(async (tx) => {
    await applyStatusChange(tx, {
      invoice,
      target: "CANCELLED",
      actingUser,
      action: "CANCEL",
      comment: reason,
    });

    if (removable.length > 0) {
      await tx.gstTransaction.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
      await writeAuditLog(
        {
          entityType: GST_ENTITY_TYPE,
          entityId: invoiceId,
          action: "VOID",
          performedById: actingUser.id,
          previousValue: {
            transactions: removable.map((r) => ({
              gstRate: round2(num(r.gstRate)),
              taxableAmount: round2(num(r.taxableAmount)),
            })),
          },
          note: `Removed with cancellation of invoice ${invoice.invoiceNumber}: ${reason}`,
        },
        tx
      );
    }
  });

  const result = await getInvoiceOr404(invoiceId);
  const warnings = [];
  if (locked.length > 0) {
    warnings.push({
      code: "GST_RECORDS_LOCKED",
      message: `${locked.length} GST record(s) for this invoice are in a filing period that has already been filed and were left in place (FRS Section 26, rule 8). Raise a credit note to reverse the output tax.`,
    });
  }
  return { ...result, warnings };
}

// ---------------------------------------------------------------------------
// Writes -- payments (FRS 15, 20, 29.6)
// ---------------------------------------------------------------------------

/**
 * The current outstanding balance for an invoice: totalAmount minus the sum
 * of every ClientPayment against it. The single definition of "what is still
 * owed" -- shared by the manual recordPayment flow below and the Payment
 * Gateway's online-payment-initiation flow (Stage 5), so the two can never
 * compute a different answer for the same invoice.
 *
 * Pass `client` as an open transaction handle when the caller needs this read
 * to be part of the same atomic unit of work as a row lock/insert that
 * follows it (both callers of this function do).
 */
export async function computeInvoiceOutstanding(invoiceId, totalAmount, client = prisma) {
  const sum = await client.clientPayment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  const receivedBefore = round2(num(sum._sum.amount));
  const remainingBefore = round2(round2(num(totalAmount)) - receivedBefore);
  return { receivedBefore, remainingBefore };
}

/**
 * Section 26 rule 9 / Section 14.2: derives PAID vs PARTIALLY_PAID from an
 * invoice's remaining balance AFTER a payment, and applies the transition
 * only if the status actually needs to change. The single place both
 * recordPayment (manual) and the Payment Gateway's verification/finalization
 * flow (Stage 6) turn "how much is left" into an invoice status change, so
 * the two payment paths can never compute a different answer for the same
 * invoice. Always called inside the caller's own transaction, same as
 * applyStatusChange itself.
 */
export async function applyPaymentStatus(tx, { invoice, actingUser, remainingAfter, comment }) {
  const target = remainingAfter <= 0 ? "PAID" : "PARTIALLY_PAID";
  if (invoice.status === target) return { statusChanged: false, status: invoice.status };
  assertStatusTransition(invoice, target);
  await applyStatusChange(tx, { invoice, target, actingUser, action: "UPDATE", comment });
  return { statusChanged: true, status: target };
}

/**
 * Records a client payment and lets the invoice status follow from it.
 *
 * Section 26 rule 9: Paid/Partially Paid are "always system-derived from
 * ClientPayment sums, never manually settable" -- which is why this is the only
 * function in the module that can produce either, and why it recomputes the sum
 * from the table inside the transaction rather than trusting a running total.
 */
export async function recordPayment(actingUser, invoiceId, input) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true, dueDate: true },
  });
  if (!invoice) throw new AppError(404, "Invoice not found.");

  if (!PAYABLE_STATUSES.includes(invoice.status)) {
    throw new AppError(
      409,
      invoice.status === "PAID"
        ? "This invoice is already fully paid."
        : `A payment can only be recorded against an invoice that has been sent to the client. This one is ${invoice.status}.`
    );
  }

  const totalAmount = round2(num(invoice.totalAmount));

  const result = await prisma.$transaction(async (tx) => {
    // Lock the invoice row for the life of this transaction before reading
    // the payment sum (Payment Gateway Stage 6, Section 9). Without this, a
    // manual payment recorded here could race a gateway payment being
    // verified/finalized (payment.service.js's verifyPayment, which takes
    // this exact same lock) -- both would read the same 'before' sum under
    // READ COMMITTED, both pass the overpayment check, and both insert,
    // overpaying the invoice. This is the same fix vendorBill.service.js's
    // recordPayment already has for vendor bills, applied here so manual and
    // online invoice payments serialize on the one lock, not two incompatible
    // mechanisms.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;

    // Re-read the sum inside the (now locked) transaction so two concurrent
    // payments cannot both pass the overpayment check against the same stale
    // balance.
    const { receivedBefore, remainingBefore } = await computeInvoiceOutstanding(invoiceId, totalAmount, tx);

    if (input.amount > remainingBefore) {
      throw new AppError(
        409,
        `Payment of ${input.amount} exceeds the ${remainingBefore} outstanding on invoice ${invoice.invoiceNumber}. ` +
          "Record the outstanding amount, or raise a credit note for the difference."
      );
    }

    const payment = await tx.clientPayment.create({
      data: {
        invoiceId,
        amount: input.amount,
        paymentDate: input.paymentDate,
        method: input.method,
        referenceNo: input.referenceNo ?? null,
        note: input.note ?? null,
      },
      select: PAYMENT_SELECT,
    });

    const receivedAfter = round2(receivedBefore + input.amount);
    const remainingAfter = round2(totalAmount - receivedAfter);

    // Section 24 names payments as an audited entity in their own right.
    await writeAuditLog(
      {
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: payment.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          amount: round2(input.amount),
          paymentDate: new Date(input.paymentDate).toISOString(),
          method: input.method,
          referenceNo: payment.referenceNo,
          amountReceived: receivedAfter,
          remainingAmount: remainingAfter,
        },
        note: input.note ?? null,
      },
      tx
    );

    // Section 14.2: "Sent → Partially Paid (less than outstanding)",
    // "Partially Paid / Sent → Paid (cumulative payments = invoice total)".
    const { statusChanged, status: target } = await applyPaymentStatus(tx, {
      invoice,
      actingUser,
      remainingAfter,
      comment: `Payment of ${round2(input.amount)} ${invoice.currency} recorded (${receivedAfter} of ${totalAmount}).`,
    });

    return { payment, receivedAfter, remainingAfter, target, statusChanged };
  });

  const warnings = [];
  if (daysBetween(new Date(), input.paymentDate) > 0) {
    warnings.push({
      code: "PAYMENT_DATE_IN_FUTURE",
      message: "The payment date is in the future; the money has not been received yet.",
    });
  }

  return {
    payment: { ...result.payment, amount: round2(num(result.payment.amount)) },
    invoice: await getInvoiceOr404(invoiceId),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Overdue (FRS 14.2 "Sent/Partially Paid → Overdue | System (auto)")
// ---------------------------------------------------------------------------

/**
 * Moves every past-due unpaid invoice to OVERDUE.
 *
 * Section 14.2 describes this as a scheduled job. There is no scheduler in the
 * codebase (Section 23's notification/scheduling layer is explicitly out of
 * Phase 1), and AuditLog.performedById is a non-null FK to User, so a
 * transition with no actor cannot be recorded at all. Rather than invent a
 * system user, this is an explicit endpoint attributed to whoever runs it --
 * which is what a cron job would call anyway once one exists.
 *
 * Nothing depends on it having run: `ar.isOverdue`, the ?overdueOnly filter and
 * both AR reports all derive overdue from dueDate directly, so the status
 * column being stale can never make a report wrong.
 */
export async function syncOverdueInvoices(actingUser) {
  const today = startOfUtcDay(new Date());

  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueDate: { lt: today },
    },
    select: { id: true, invoiceNumber: true, status: true, dueDate: true },
  });

  const updated = [];
  for (const invoice of candidates) {
    await prisma.$transaction((tx) =>
      applyStatusChange(tx, {
        invoice,
        target: "OVERDUE",
        actingUser,
        action: "UPDATE",
        comment: `Automatic overdue sweep: due ${new Date(invoice.dueDate).toISOString().slice(0, 10)}, ${daysBetween(invoice.dueDate, today)} day(s) past due.`,
      })
    );
    updated.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      previousStatus: invoice.status,
      daysPastDue: daysBetween(invoice.dueDate, today),
    });
  }

  return { checkedAt: today, markedOverdue: updated.length, invoices: updated };
}

// ---------------------------------------------------------------------------
// AR reports (FRS 15.3, 29.6 /reports/ar/*)
// ---------------------------------------------------------------------------

/**
 * Shared loader for both AR reports: every non-cancelled, non-paid invoice
 * with its payments, reduced to the Section 15.2 derived values. Status is not
 * trusted for the "is it overdue" decision -- dueDate is.
 */
async function loadReceivables({ clientId, projectId, asOf }) {
  const rows = await prisma.invoice.findMany({
    where: {
      status: { in: OUTSTANDING_STATUSES },
      ...(clientId ? { clientId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    include: {
      client: { select: { id: true, name: true, currency: true } },
      project: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });

  return rows
    .map((row) => {
      const totalAmount = round2(num(row.totalAmount));
      const amountReceived = round2(row.payments.reduce((s, p) => s + num(p.amount), 0));
      const remainingAmount = round2(totalAmount - amountReceived);
      const daysPastDue = daysBetween(row.dueDate, asOf);

      return {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status,
        client: row.client,
        project: row.project,
        currency: row.currency,
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        totalAmount,
        amountReceived,
        remainingAmount,
        daysPastDue: daysPastDue > 0 ? daysPastDue : 0,
        isOverdue: remainingAmount > 0 && daysPastDue > 0,
      };
    })
    // A fully-paid invoice whose status has not caught up is not a receivable.
    .filter((row) => row.remainingAmount > 0);
}

/** FRS 15.3 "Outstanding Invoice Report — all invoices with Remaining Amount > 0". */
export async function getOutstandingReport({ clientId, projectId, asOf }) {
  const asOfDate = startOfUtcDay(asOf || new Date());
  const rows = await loadReceivables({ clientId, projectId, asOf: asOfDate });

  const byClient = new Map();
  for (const row of rows) {
    const entry = byClient.get(row.client.id) || {
      client: row.client,
      invoiceCount: 0,
      totalOutstanding: 0,
      overdueOutstanding: 0,
    };
    entry.invoiceCount += 1;
    entry.totalOutstanding = round2(entry.totalOutstanding + row.remainingAmount);
    if (row.isOverdue) entry.overdueOutstanding = round2(entry.overdueOutstanding + row.remainingAmount);
    byClient.set(row.client.id, entry);
  }

  return {
    asOf: asOfDate,
    summary: {
      invoiceCount: rows.length,
      totalOutstanding: round2(rows.reduce((s, r) => s + r.remainingAmount, 0)),
      overdueCount: rows.filter((r) => r.isOverdue).length,
      overdueOutstanding: round2(rows.filter((r) => r.isOverdue).reduce((s, r) => s + r.remainingAmount, 0)),
    },
    byClient: [...byClient.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding),
    invoices: rows,
    // Mixed-currency invoices would make these sums meaningless; say so rather
    // than presenting a total that silently adds INR to USD.
    caveats: buildCurrencyCaveats(rows),
  };
}

/** FRS 15.3 "Aging Report — outstanding invoices bucketed by how overdue". */
export async function getAgingReport({ clientId, projectId, asOf }) {
  const asOfDate = startOfUtcDay(asOf || new Date());
  const rows = await loadReceivables({ clientId, projectId, asOf: asOfDate });

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
      invoiceCount: matched.length,
      amount: round2(matched.reduce((s, r) => s + r.remainingAmount, 0)),
      invoices: matched.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        client: r.client,
        dueDate: r.dueDate,
        remainingAmount: r.remainingAmount,
        daysPastDue: r.daysPastDue,
      })),
    };
  });

  return {
    asOf: asOfDate,
    summary: {
      invoiceCount: rows.length,
      totalOutstanding: round2(rows.reduce((s, r) => s + r.remainingAmount, 0)),
    },
    buckets,
    caveats: buildCurrencyCaveats(rows),
  };
}

/** FRS 15.3 "Client Payment Report — payment history per client, per period". */
export async function getClientPaymentReport({ clientId, from, to }) {
  const payments = await prisma.clientPayment.findMany({
    where: {
      ...(clientId ? { invoice: { clientId } } : {}),
      ...(from || to
        ? {
            paymentDate: {
              ...(from ? { gte: startOfUtcDay(from) } : {}),
              ...(to ? { lte: startOfUtcDay(to) } : {}),
            },
          }
        : {}),
    },
    select: {
      ...PAYMENT_SELECT,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          currency: true,
          totalAmount: true,
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ paymentDate: "desc" }],
  });

  const byClient = new Map();
  for (const payment of payments) {
    const client = payment.invoice.client;
    const entry = byClient.get(client.id) || { client, paymentCount: 0, totalReceived: 0 };
    entry.paymentCount += 1;
    entry.totalReceived = round2(entry.totalReceived + num(payment.amount));
    byClient.set(client.id, entry);
  }

  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: {
      paymentCount: payments.length,
      totalReceived: round2(payments.reduce((s, p) => s + num(p.amount), 0)),
    },
    byClient: [...byClient.values()].sort((a, b) => b.totalReceived - a.totalReceived),
    payments: payments.map((p) => ({
      ...p,
      amount: round2(num(p.amount)),
      invoice: { ...p.invoice, totalAmount: round2(num(p.invoice.totalAmount)) },
    })),
  };
}


// ---------------------------------------------------------------------------
// Supporting documents (FRS 14.1)
// ---------------------------------------------------------------------------

/**
 * Checked BEFORE multer writes anything, so an upload against a non-existent
 * or already-issued invoice never touches the disk (Section 32).
 */
export async function assertCanAttachDocument(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true },
  });
  if (!invoice) throw new AppError(404, "Invoice not found.");
  if (TERMINAL_STATUSES.includes(invoice.status)) {
    throw new AppError(409, `Cannot attach a document to a ${invoice.status} invoice.`);
  }
  return invoice;
}

export async function addDocument(actingUser, invoiceId, file) {
  // Re-checked rather than trusting the pre-multer guard: the invoice could
  // have changed status during the upload, and this is the write path.
  await assertCanAttachDocument(invoiceId);

  const document = await prisma.invoiceDocument.create({
    data: {
      invoiceId,
      storageKey: path.basename(file.filename),
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: actingUser.id,
    },
    select: DOCUMENT_SELECT,
  });

  await writeAuditLog({
    entityType: ENTITY_TYPE,
    entityId: invoiceId,
    action: "UPDATE",
    performedById: actingUser.id,
    newValue: { documentAdded: document.id, originalFileName: document.originalFileName },
  });

  return document;
}

export async function getDocumentForDownload(invoiceId, documentId) {
  const document = await prisma.invoiceDocument.findUnique({ where: { id: documentId } });
  // Scoped to the invoice in the URL, so a document id alone cannot be walked.
  if (!document || document.invoiceId !== invoiceId) {
    throw new AppError(404, "Document not found.");
  }

  return {
    absolutePath: resolveUploadPath(DOCUMENT_SUBFOLDER, document.storageKey),
    mimeType: document.mimeType,
    originalFileName: document.originalFileName,
  };
}
