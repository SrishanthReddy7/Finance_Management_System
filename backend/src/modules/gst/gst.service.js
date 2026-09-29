// GST & Tax Management (FRS Section 17, Section 18's boundary, Section 29.8).
//
// This module does NOT calculate GST from source documents. That already
// happens where the tax event occurs -- utils/gst.js splits CGST/SGST/IGST and
// is called by invoice.service at send and vendorBill.service at approve. A
// second implementation here would be a second answer to the same question, so
// what lives here is everything downstream of the split: reading the rows,
// grouping them into filing periods, summarising them, reconciling them back
// against the documents they came from, and tracking the filing lifecycle.
//
// Section 18 is a hard boundary and is respected literally: nothing here talks
// to a government portal, and nothing emits a GSTR-1/3B payload. "Filed" means
// a human filed it elsewhere and then told the system so.
//
// Permission gating is at the route layer (VIEW_GST / PREPARE_GST_FILING /
// SUBMIT_GST_FILING) so the Section 30 Super Admin bypass in requirePermission
// keeps applying. The one rule that cannot be a permission code -- the preparer
// of a period may not also be the one who marks it Filed -- is enforced here,
// because it compares the caller against the period's own preparedById.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { recordApprovalStep, listApprovalSteps } from "../../utils/approvalHistory.js";
import { env } from "../../config/env.js";
import {
  resolveFilingPeriod,
  isPeriodLocked,
  formatPeriodLabel,
  periodKeyOf,
} from "../../utils/gstPeriod.js";
import { GSTIN_REGEX, gstinStateCode } from "../../utils/gstin.js";
import { GST_DIRECTIONS, GST_FILING_STATUSES } from "./gst.validation.js";

const PERIOD_ENTITY_TYPE = "GstFilingPeriod";
const TRANSACTION_ENTITY_TYPE = "GstTransaction";

const num = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * FRS 17.2's filing lifecycle. READY is the internal-review sign-off ("Finance
 * checks summary for errors"), and it is reversible: a review that finds a
 * problem has to be able to send the period back for correction, or the only
 * way to fix something spotted at review would be to file it wrong.
 *
 * FILED and ACKNOWLEDGED are terminal for the data underneath them -- Section
 * 26 rule 8 makes every transaction in the period read-only at that point.
 */
const PERIOD_TRANSITIONS = {
  NOT_STARTED: ["IN_PREPARATION"],
  IN_PREPARATION: ["READY"],
  READY: ["FILED", "IN_PREPARATION"],
  FILED: ["ACKNOWLEDGED"],
  ACKNOWLEDGED: [],
};

// ---------------------------------------------------------------------------
// Shared shaping
// ---------------------------------------------------------------------------

/**
 * FRS 17.4's "input/output flag" says what a row is; this says where it came
 * from. Derived rather than stored: the two nullable FKs already carry the
 * answer, and a stored copy could contradict them.
 */
export function sourceOf(row) {
  if (row.invoiceId) return "INVOICE";
  if (row.vendorBillId) return "VENDOR_BILL";
  return "MANUAL_ADJUSTMENT";
}

const totalTaxOf = (row) => round2(num(row.cgstAmount) + num(row.sgstAmount) + num(row.igstAmount));

/**
 * Place of supply, read back off the row rather than recomputed. A non-zero
 * IGST amount means the counterparty was in another state at the moment the
 * document was issued; recomputing it now from the client's or vendor's current
 * GSTIN would give a different answer if that GSTIN has since been corrected,
 * and would then disagree with the tax actually charged.
 */
const placeOfSupplyOf = (row) => (num(row.igstAmount) !== 0 ? "INTER_STATE" : "INTRA_STATE");

function shapePeriod(period) {
  if (!period) return null;
  return {
    id: period.id,
    label: formatPeriodLabel(period),
    periodMonth: period.periodMonth,
    periodYear: period.periodYear,
    status: period.status,
    locked: isPeriodLocked(period),
    preparedById: period.preparedById,
    preparedAt: period.preparedAt,
    filedById: period.filedById,
    filedAt: period.filedAt,
    referenceNo: period.referenceNo,
    acknowledgedAt: period.acknowledgedAt,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
  };
}

/**
 * The document-date window a period covers, as a UTC half-open month. Used to
 * scope the "no GST records at all" sweep in reconcile() -- without it, one
 * period's summary would report every gap in the database as its own.
 */
function periodWindow(period) {
  return {
    from: new Date(Date.UTC(period.periodYear, period.periodMonth - 1, 1)),
    to: new Date(Date.UTC(period.periodYear, period.periodMonth, 1) - 1),
  };
}

function decorateTransaction(row) {
  return {
    id: row.id,
    direction: row.direction,
    source: sourceOf(row),
    placeOfSupply: placeOfSupplyOf(row),
    documentDate: row.documentDate,
    gstRate: num(row.gstRate),
    taxableAmount: num(row.taxableAmount),
    cgstAmount: num(row.cgstAmount),
    sgstAmount: num(row.sgstAmount),
    igstAmount: num(row.igstAmount),
    totalTax: totalTaxOf(row),
    note: row.note,
    createdById: row.createdById,
    createdAt: row.createdAt,
    filingPeriod: shapePeriod(row.filingPeriod),
    invoice: row.invoice
      ? {
          id: row.invoice.id,
          invoiceNumber: row.invoice.invoiceNumber,
          documentDate: row.invoice.invoiceDate,
          status: row.invoice.status,
          counterparty: row.invoice.client
            ? {
                id: row.invoice.client.id,
                name: row.invoice.client.name,
                gstin: row.invoice.client.gstin,
              }
            : null,
        }
      : null,
    vendorBill: row.vendorBill
      ? {
          id: row.vendorBill.id,
          billNumber: row.vendorBill.billNumber,
          documentDate: row.vendorBill.billDate,
          status: row.vendorBill.status,
          counterparty: row.vendorBill.vendor
            ? {
                id: row.vendorBill.vendor.id,
                name: row.vendorBill.vendor.name,
                gstin: row.vendorBill.vendor.gstin,
              }
            : null,
        }
      : null,
  };
}

/**
 * Only the fields the GST module needs. In particular it selects the vendor's
 * name and GSTIN but never its bankDetails -- VIEW_GST is a wider audience than
 * the Section 32 gate on payment details, and a tax report is no reason to
 * widen it.
 */
const TRANSACTION_INCLUDE = {
  filingPeriod: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      client: { select: { id: true, name: true, gstin: true } },
    },
  },
  vendorBill: {
    select: {
      id: true,
      billNumber: true,
      billDate: true,
      status: true,
      vendor: { select: { id: true, name: true, gstin: true } },
    },
  },
};

// ---------------------------------------------------------------------------
// Configuration / master data -- FRS Section 31 "Settings ... GST registration
// details", Section 17.4's field list
// ---------------------------------------------------------------------------

/**
 * What the module treats as GST master data, and deliberately nothing more.
 *
 * The FRS defines no rate master: Section 28's model list has no GstRate table,
 * and a rate lives on the invoice or bill line that charged it
 * (`taxRate Decimal(5,2)`). Inventing a rates table would be inventing a
 * requirement, and would immediately be wrong the next time the GST Council
 * changes a slab and historic documents have to keep their old rate. So
 * `ratesInUse` is observed from the transactions themselves rather than
 * configured -- it tells Finance which slabs the company is actually operating
 * on, which is the question a rate master would have been asked anyway.
 *
 * The registration itself comes from COMPANY_GSTIN in the environment and is
 * never hardcoded. While it is unset the endpoint says so plainly rather than
 * reporting a default, because its first two characters are the state code that
 * the whole CGST/SGST-vs-IGST decision rests on.
 */
export async function getGstConfig() {
  const rateGroups = await prisma.gstTransaction.groupBy({
    by: ["gstRate", "direction"],
    _count: { _all: true },
  });

  const byRate = new Map();
  for (const g of rateGroups) {
    const rate = num(g.gstRate);
    const entry = byRate.get(rate) || { gstRate: rate, outputCount: 0, inputCount: 0 };
    if (g.direction === "OUTPUT") entry.outputCount += g._count._all;
    else entry.inputCount += g._count._all;
    byRate.set(rate, entry);
  }

  return {
    registration: {
      companyGstin: env.companyGstin,
      configured: Boolean(env.companyGstin),
      stateCode: gstinStateCode(env.companyGstin),
      // FRS Section 34 defers multi-state registration to a later phase, so
      // exactly one registration is supported and callers should not assume
      // they can select one per document.
      multiRegistrationSupported: false,
      source: "COMPANY_GSTIN environment variable (FRS Section 31 Settings)",
    },
    validation: {
      gstinPattern: GSTIN_REGEX.source,
      gstinDescription:
        "15 characters: 2-digit state code, 10-character PAN, entity code, literal Z, checksum (FRS 17.4, FR-20).",
      maxGstRate: 100,
      gstRateDecimalPlaces: 2,
    },
    enums: {
      directions: GST_DIRECTIONS,
      filingStatuses: GST_FILING_STATUSES,
      transactionSources: ["INVOICE", "VENDOR_BILL", "MANUAL_ADJUSTMENT"],
    },
    ratesInUse: [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate),
    rateMaster: {
      maintained: false,
      reason:
        "The FRS defines no GST rate master (Section 28 has no such model); a rate is recorded on the invoice " +
        "or vendor bill line that charged it, so historic documents keep the rate that actually applied.",
    },
    filing: {
      // Section 18, restated at the API surface so no consumer can assume it.
      governmentSubmission: false,
      note:
        "This system records, calculates and reports GST. It does not submit anything to the GST portal " +
        "(FRS Section 18). A period is marked Filed by a person after they have filed it externally.",
    },
    warnings: registrationWarnings(),
  };
}

// ---------------------------------------------------------------------------
// Transactions -- FRS 29.8 GET /gst/transactions
// ---------------------------------------------------------------------------

function buildTransactionWhere({
  direction,
  periodId,
  period,
  invoiceId,
  vendorBillId,
  source,
  gstRate,
  from,
  to,
}) {
  const where = {};
  if (direction) where.direction = direction;
  if (periodId) where.filingPeriodId = periodId;
  if (period) {
    const [year, month] = period.split("-").map(Number);
    where.filingPeriod = { periodYear: year, periodMonth: month };
  }
  if (invoiceId) where.invoiceId = invoiceId;
  if (vendorBillId) where.vendorBillId = vendorBillId;
  if (gstRate != null) where.gstRate = gstRate;
  if (source === "INVOICE") where.invoiceId = { not: null };
  if (source === "VENDOR_BILL") where.vendorBillId = { not: null };
  if (source === "MANUAL_ADJUSTMENT") {
    where.invoiceId = null;
    where.vendorBillId = null;
  }
  if (from || to) {
    where.documentDate = {};
    if (from) where.documentDate.gte = from;
    if (to) where.documentDate.lte = to;
  }
  return where;
}

export async function listGstTransactions({ skip, take, ...filters }) {
  const where = buildTransactionWhere(filters);
  const [rows, totalCount] = await Promise.all([
    prisma.gstTransaction.findMany({
      where,
      skip,
      take,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      include: TRANSACTION_INCLUDE,
    }),
    prisma.gstTransaction.count({ where }),
  ]);
  return { rows: rows.map(decorateTransaction), totalCount };
}

export async function getGstTransactionOr404(id) {
  const row = await prisma.gstTransaction.findUnique({
    where: { id },
    include: TRANSACTION_INCLUDE,
  });
  if (!row) throw new AppError(404, "GST transaction not found.");
  return decorateTransaction(row);
}

// ---------------------------------------------------------------------------
// Manual adjustment entries -- FRS 17.3, Section 37 Q16
// ---------------------------------------------------------------------------

/**
 * The correction mechanism for an already-recorded GST figure.
 *
 * Rows generated from an invoice or a vendor bill are never edited. That is
 * what keeps `reconciliation` in the period summary meaningful: every
 * auto-generated row still equals the tax on the document that produced it, so
 * a divergence there is a real data problem rather than a permitted override.
 * A wrong figure is corrected by posting the difference as its own signed
 * entry, which is the shape a journal reversal takes in any ledger and leaves
 * both the original and the correction visible to whoever signs the return.
 *
 * An adjustment cannot be edited or deleted either, for the same reason and for
 * Section 26 rule 6. A mistaken adjustment is undone by posting its opposite.
 */
export async function createAdjustment(actingUser, input) {
  const { period, rolledForward, naturalPeriodLabel } = await resolveFilingPeriod(input.documentDate);

  // Unlike an invoice being sent, this is a deliberate act of tax admin aimed at
  // one specific period, so rolling it silently into the next one would be the
  // wrong kindness -- the preparer needs to know their target is closed and
  // decide for themselves where the correction really belongs.
  if (rolledForward) {
    throw new AppError(
      409,
      `The ${naturalPeriodLabel} filing period is already filed and is read-only (FRS Section 26, rule 8). ` +
        "Post the adjustment with a documentDate inside an open period instead -- " +
        `${formatPeriodLabel(period)} is the next one open.`
    );
  }

  const createdId = await prisma.$transaction(async (tx) => {
    const row = await tx.gstTransaction.create({
      data: {
        direction: input.direction,
        filingPeriodId: period.id,
        documentDate: input.documentDate,
        gstRate: input.gstRate,
        taxableAmount: input.taxableAmount,
        cgstAmount: input.cgstAmount,
        sgstAmount: input.sgstAmount,
        igstAmount: input.igstAmount,
        createdById: actingUser.id,
        note: input.note,
      },
    });

    await writeAuditLog(
      {
        entityType: TRANSACTION_ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          source: "MANUAL_ADJUSTMENT",
          direction: row.direction,
          filingPeriod: formatPeriodLabel(period),
          gstRate: num(row.gstRate),
          taxableAmount: num(row.taxableAmount),
          cgstAmount: num(row.cgstAmount),
          sgstAmount: num(row.sgstAmount),
          igstAmount: num(row.igstAmount),
        },
        note: input.note,
      },
      tx
    );
    return row.id;
  });

  const result = await getGstTransactionOr404(createdId);
  const warnings = [];
  if (period.status === "READY") {
    warnings.push({
      code: "PERIOD_ALREADY_READY",
      message:
        `Filing period ${formatPeriodLabel(period)} had already been marked Ready. The adjustment has been ` +
        "posted into it, so the summary that was reviewed is now out of date -- re-check it before filing.",
    });
  }
  return { ...result, warnings };
}

// ---------------------------------------------------------------------------
// Summaries -- FRS 17.1 "internal summaries per tax period", 29.8 summary
// ---------------------------------------------------------------------------

const emptyLeg = () => ({
  taxableAmount: 0,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 0,
  totalTax: 0,
  transactionCount: 0,
});

function addInto(leg, row) {
  leg.taxableAmount = round2(leg.taxableAmount + num(row.taxableAmount));
  leg.cgstAmount = round2(leg.cgstAmount + num(row.cgstAmount));
  leg.sgstAmount = round2(leg.sgstAmount + num(row.sgstAmount));
  leg.igstAmount = round2(leg.igstAmount + num(row.igstAmount));
  leg.totalTax = round2(leg.totalTax + totalTaxOf(row));
  leg.transactionCount += 1;
  return leg;
}

/**
 * FRS 17.1: "total output tax, total input tax, net payable".
 *
 * Netting is reported two ways because the two answer different questions. The
 * headline `netPayable` is output minus input and is what Section 21's
 * dashboard and Section 22's tax summary want. `byHead` nets CGST against
 * CGST, SGST against SGST and IGST against IGST, which is how the liability
 * actually settles -- input CGST cannot be set against an SGST liability -- so
 * the two figures legitimately differ when a period mixes intra-state purchases
 * with inter-state sales. Showing only the headline would understate what has
 * to be paid in cash in exactly that case.
 *
 * Both are presented as internal aggregates, not as a computed return. Section
 * 18 rules out anything that claims to be a filing figure.
 */
export function summariseTransactions(rows) {
  const output = emptyLeg();
  const input = emptyLeg();
  const byRate = new Map();
  const bySource = {
    INVOICE: emptyLeg(),
    VENDOR_BILL: emptyLeg(),
    MANUAL_ADJUSTMENT: emptyLeg(),
  };

  for (const row of rows) {
    const leg = row.direction === "OUTPUT" ? output : input;
    addInto(leg, row);
    addInto(bySource[sourceOf(row)], row);

    const rate = num(row.gstRate);
    if (!byRate.has(rate)) {
      byRate.set(rate, { gstRate: rate, output: emptyLeg(), input: emptyLeg() });
    }
    addInto(byRate.get(rate)[row.direction === "OUTPUT" ? "output" : "input"], row);
  }

  const netTotalTax = round2(output.totalTax - input.totalTax);
  const byHead = {
    cgst: round2(output.cgstAmount - input.cgstAmount),
    sgst: round2(output.sgstAmount - input.sgstAmount),
    igst: round2(output.igstAmount - input.igstAmount),
  };

  return {
    output,
    input,
    // FRS 17's plain-language framing: input tax is "tax the company can
    // usually claim back/offset against output tax -- called Input Tax Credit".
    inputTaxCredit: input.totalTax,
    net: {
      totalTax: netTotalTax,
      // Positive means the company owes the government; negative means it is
      // carrying a credit forward. Both are surfaced explicitly so no caller
      // has to infer the sign convention.
      payable: netTotalTax > 0 ? netTotalTax : 0,
      refundable: netTotalTax < 0 ? round2(-netTotalTax) : 0,
      byHead,
    },
    byRate: [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate),
    bySource,
    transactionCount: output.transactionCount + input.transactionCount,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation -- the user's STEP 4, "calculations reconcile with Invoice and
// Vendor/AP data"
// ---------------------------------------------------------------------------

/**
 * Two distinct failure modes, checked separately because they have different
 * causes and different fixes:
 *
 *  - `mismatchedDocuments`: a document whose GST rows no longer sum to the tax
 *    on its own line items. Nothing in the system is supposed to be able to
 *    produce this, which is exactly why it is worth asserting -- if it ever
 *    appears it means data was changed outside the application.
 *
 *  - `documentsMissingGst`: a document that became a tax event inside this
 *    window but produced no GST rows at all. This one is expected today: with
 *    COMPANY_GSTIN unset, utils/gst.js cannot decide place of supply and
 *    deliberately records nothing. Listing them turns a silent gap into a
 *    checklist of what has to be back-posted once the registration is
 *    configured.
 */
async function reconcile(rows, { from, to }) {
  const invoiceIds = [...new Set(rows.filter((r) => r.invoiceId).map((r) => r.invoiceId))];
  const billIds = [...new Set(rows.filter((r) => r.vendorBillId).map((r) => r.vendorBillId))];

  const [invoices, bills] = await Promise.all([
    invoiceIds.length
      ? prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            invoiceNumber: true,
            lineItems: { select: { lineTotal: true, taxRate: true } },
          },
        })
      : [],
    billIds.length
      ? prisma.vendorBill.findMany({
          where: { id: { in: billIds } },
          select: {
            id: true,
            billNumber: true,
            items: { select: { amount: true, taxRate: true } },
          },
        })
      : [],
  ]);

  const recordedByDoc = new Map();
  for (const row of rows) {
    const key = row.invoiceId || row.vendorBillId;
    if (!key) continue;
    recordedByDoc.set(key, round2((recordedByDoc.get(key) || 0) + totalTaxOf(row)));
  }

  const mismatchedDocuments = [];

  for (const inv of invoices) {
    const expected = round2(
      inv.lineItems.reduce((s, li) => s + (num(li.lineTotal) * num(li.taxRate)) / 100, 0)
    );
    const recorded = recordedByDoc.get(inv.id) || 0;
    if (Math.abs(expected - recorded) > 0.01) {
      mismatchedDocuments.push({
        documentType: "INVOICE",
        id: inv.id,
        documentNumber: inv.invoiceNumber,
        taxOnDocument: expected,
        taxInGstRecords: recorded,
        difference: round2(recorded - expected),
      });
    }
  }

  for (const bill of bills) {
    const expected = round2(
      bill.items.reduce((s, li) => s + (num(li.amount) * num(li.taxRate)) / 100, 0)
    );
    const recorded = recordedByDoc.get(bill.id) || 0;
    if (Math.abs(expected - recorded) > 0.01) {
      mismatchedDocuments.push({
        documentType: "VENDOR_BILL",
        id: bill.id,
        documentNumber: bill.billNumber,
        taxOnDocument: expected,
        taxInGstRecords: recorded,
        difference: round2(recorded - expected),
      });
    }
  }

  // Documents that became a tax event in this window but wrote no GST rows.
  // An invoice is a tax event once SENT (and stays one through payment and
  // overdue); a vendor bill once APPROVED. Cancelled documents are excluded on
  // both sides -- cancelling already removes their unfiled rows.
  const dateWindow = {};
  if (from) dateWindow.gte = from;
  if (to) dateWindow.lte = to;
  const hasWindow = Boolean(from || to);

  const [missingInvoices, missingBills] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
        gstTransactions: { none: {} },
        ...(hasWindow ? { invoiceDate: dateWindow } : {}),
      },
      select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true },
      take: 200,
    }),
    prisma.vendorBill.findMany({
      where: {
        status: { in: ["APPROVED", "PARTIALLY_PAID", "PAID"] },
        gstTransactions: { none: {} },
        ...(hasWindow ? { billDate: dateWindow } : {}),
      },
      select: { id: true, billNumber: true, billDate: true, totalAmount: true },
      take: 200,
    }),
  ]);

  return {
    balanced: mismatchedDocuments.length === 0,
    documentsChecked: invoices.length + bills.length,
    mismatchedDocuments,
    documentsMissingGst: [
      ...missingInvoices.map((i) => ({
        documentType: "INVOICE",
        id: i.id,
        documentNumber: i.invoiceNumber,
        documentDate: i.invoiceDate,
        totalAmount: num(i.totalAmount),
      })),
      ...missingBills.map((b) => ({
        documentType: "VENDOR_BILL",
        id: b.id,
        documentNumber: b.billNumber,
        documentDate: b.billDate,
        totalAmount: num(b.totalAmount),
      })),
    ],
  };
}

/** The one warning every GST read carries while the registration is unset. */
function registrationWarnings() {
  if (env.companyGstin) return [];
  return [
    {
      code: "GST_REGISTRATION_NOT_CONFIGURED",
      message:
        "COMPANY_GSTIN is not set, so no place-of-supply decision can be made and no CGST/SGST/IGST is being " +
        "recorded on new invoices or vendor bills. Figures below cover only documents raised while it was " +
        "configured. Set COMPANY_GSTIN before preparing a return.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Filing periods -- FRS 17.2, 29.8
// ---------------------------------------------------------------------------

export async function listPeriods({ status, periodYear, skip, take }) {
  const where = {};
  if (status) where.status = status;
  if (periodYear) where.periodYear = periodYear;

  const [periods, totalCount] = await Promise.all([
    prisma.gstFilingPeriod.findMany({
      where,
      skip,
      take,
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    }),
    prisma.gstFilingPeriod.count({ where }),
  ]);

  // One grouped query for all of them rather than N summary queries: a status
  // board is the main consumer here and it wants headline numbers, not detail.
  const totals = periods.length
    ? await prisma.gstTransaction.groupBy({
        by: ["filingPeriodId", "direction"],
        where: { filingPeriodId: { in: periods.map((p) => p.id) } },
        _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxableAmount: true },
        _count: { _all: true },
      })
    : [];

  const byPeriod = new Map();
  for (const group of totals) {
    const entry = byPeriod.get(group.filingPeriodId) || { OUTPUT: 0, INPUT: 0, count: 0 };
    entry[group.direction] = round2(
      num(group._sum.cgstAmount) + num(group._sum.sgstAmount) + num(group._sum.igstAmount)
    );
    entry.count += group._count._all;
    byPeriod.set(group.filingPeriodId, entry);
  }

  const rows = periods.map((period) => {
    const t = byPeriod.get(period.id) || { OUTPUT: 0, INPUT: 0, count: 0 };
    const net = round2(t.OUTPUT - t.INPUT);
    return {
      ...shapePeriod(period),
      totals: {
        outputTax: t.OUTPUT,
        inputTax: t.INPUT,
        netTotalTax: net,
        payable: net > 0 ? net : 0,
        refundable: net < 0 ? round2(-net) : 0,
        transactionCount: t.count,
      },
    };
  });

  return { rows, totalCount, warnings: registrationWarnings() };
}

async function loadPeriodOr404(periodId) {
  const period = await prisma.gstFilingPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new AppError(404, "GST filing period not found.");
  return period;
}

/** Resolves the plain actor-id columns to something a UI can display. */
async function resolveActors(period) {
  const ids = [period.preparedById, period.filedById].filter(Boolean);
  if (ids.length === 0) return { preparedBy: null, filedBy: null };
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    preparedBy: period.preparedById ? byId.get(period.preparedById) || { id: period.preparedById } : null,
    filedBy: period.filedById ? byId.get(period.filedById) || { id: period.filedById } : null,
  };
}

/**
 * FRS 29.8 GET /gst/periods/:periodId/summary. Also serves as the period detail
 * endpoint -- a filing period with its numbers removed is just a status, and
 * every caller that wants one wants the other.
 */
export async function getPeriodSummary(periodId) {
  const period = await loadPeriodOr404(periodId);
  const [rows, actors, history] = await Promise.all([
    prisma.gstTransaction.findMany({
      where: { filingPeriodId: periodId },
      include: TRANSACTION_INCLUDE,
    }),
    resolveActors(period),
    listApprovalSteps(PERIOD_ENTITY_TYPE, periodId),
  ]);

  const summary = summariseTransactions(rows);
  const reconciliation = await reconcile(rows, periodWindow(period));

  const warnings = registrationWarnings();
  if (summary.transactionCount === 0) {
    warnings.push({
      code: "PERIOD_EMPTY",
      message: `No GST transactions have been recorded in ${formatPeriodLabel(period)}.`,
    });
  }
  if (!reconciliation.balanced) {
    warnings.push({
      code: "RECONCILIATION_MISMATCH",
      message:
        `${reconciliation.mismatchedDocuments.length} document(s) in this period have GST records that do not ` +
        "match the tax on their own line items. Review them before filing.",
    });
  }
  // Rows whose document belongs to an earlier month, carried in under rule 8.
  const lateEntries = rows.filter((r) => {
    const key = periodKeyOf(r.documentDate);
    return key.periodYear !== period.periodYear || key.periodMonth !== period.periodMonth;
  });
  if (lateEntries.length > 0) {
    warnings.push({
      code: "LATE_ENTRIES_CARRIED_IN",
      message:
        `${lateEntries.length} transaction(s) in this period are dated outside it. They were carried forward ` +
        "because their own period was already filed (FRS Section 26, rule 8).",
    });
  }

  return {
    period: { ...shapePeriod(period), ...actors },
    summary,
    reconciliation,
    lateEntries: lateEntries.map(decorateTransaction),
    approvalHistory: history,
    warnings,
  };
}

/**
 * STEP 3's "period creation". FRS 29.8 has no POST, because in normal running a
 * period is created by the first invoice or bill that lands in it -- see
 * utils/gstPeriod.resolveFilingPeriod. This exists so Finance can open a period
 * ahead of any activity, which is what makes the Section 31 status board show
 * next month as Not Started rather than as nothing at all.
 */
export async function createPeriod(actingUser, { periodMonth, periodYear }) {
  const existing = await prisma.gstFilingPeriod.findUnique({
    where: { periodMonth_periodYear: { periodMonth, periodYear } },
  });
  if (existing) {
    throw new AppError(
      409,
      `Filing period ${formatPeriodLabel({ periodMonth, periodYear })} already exists ` +
        `with status ${existing.status}.`
    );
  }

  const id = await prisma.$transaction(async (tx) => {
    const period = await tx.gstFilingPeriod.create({ data: { periodMonth, periodYear } });
    await writeAuditLog(
      {
        entityType: PERIOD_ENTITY_TYPE,
        entityId: period.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: { period: formatPeriodLabel(period), status: period.status },
      },
      tx
    );
    return period.id;
  });

  return getPeriodSummary(id);
}

function assertPeriodTransition(period, target) {
  const allowed = PERIOD_TRANSITIONS[period.status] || [];
  if (!allowed.includes(target)) {
    throw new AppError(
      409,
      `A filing period that is ${period.status} cannot move to ${target}. ` +
        (allowed.length
          ? `Allowed from here: ${allowed.join(", ")}.`
          : "This period is closed; its records are read-only (FRS Section 26, rule 8).")
    );
  }
}

/**
 * Writes the status change plus its audit and approval-history rows in one
 * transaction (FRS Section 26, rule 7), so a period can never show a new status
 * with no record of who moved it there.
 */
async function applyPeriodChange(tx, { period, target, actingUser, extraData = {}, comment = null }) {
  const updated = await tx.gstFilingPeriod.update({
    where: { id: period.id },
    data: { status: target, ...extraData },
  });

  await writeAuditLog(
    {
      entityType: PERIOD_ENTITY_TYPE,
      entityId: period.id,
      action: "UPDATE",
      performedById: actingUser.id,
      previousValue: { status: period.status },
      newValue: { status: target, ...extraData },
      note: comment,
    },
    tx
  );

  await recordApprovalStep(
    {
      entityType: PERIOD_ENTITY_TYPE,
      entityId: period.id,
      actorUserId: actingUser.id,
      fromStatus: period.status,
      toStatus: target,
      comment,
    },
    tx
  );

  return updated;
}

/** FRS 29.8 PATCH /gst/periods/:periodId/prepare -- "Mark In Preparation/Ready". */
export async function preparePeriod(actingUser, periodId, { status, comment }) {
  const period = await loadPeriodOr404(periodId);
  assertPeriodTransition(period, status);

  const extraData = {};
  if (status === "IN_PREPARATION" || status === "READY") {
    // Ownership of the preparation follows the last person to touch it, which
    // is also what the maker-checker test at mark-filed reads.
    extraData.preparedById = actingUser.id;
    extraData.preparedAt = new Date();
  }

  await prisma.$transaction(async (tx) => {
    await applyPeriodChange(tx, { period, target: status, actingUser, extraData, comment });
  });

  const result = await getPeriodSummary(periodId);
  if (status === "READY" && result.summary.transactionCount === 0) {
    // Warn, do not block: a genuinely nil period still has to be marked Ready
    // and filed, so refusing an empty one would make a normal month impossible.
    result.warnings.push({
      code: "READY_WITH_NO_TRANSACTIONS",
      message: "This period has been marked Ready with no GST transactions in it. Confirm that is intended.",
    });
  }
  return result;
}

/**
 * FRS 29.8 PATCH /gst/periods/:periodId/mark-filed -- "Mark Filed + store
 * reference". Section 17.2: the human filed it on the portal, then tells the
 * system. Nothing here submits anything (Section 18).
 *
 * Maker-checker: the person who prepared the period cannot be the one who
 * records it as filed. That is the same rule invoices and vendor bills already
 * apply to creator-vs-approver, and it holds for SUPER_ADMIN too -- the Section
 * 30 bypass is about permissions, and this is not one.
 */
export async function markPeriodFiled(actingUser, periodId, { referenceNo, filedDate, comment }) {
  const period = await loadPeriodOr404(periodId);
  assertPeriodTransition(period, "FILED");

  if (period.preparedById && period.preparedById === actingUser.id) {
    throw new AppError(
      409,
      "You prepared this GST period, so you cannot also record it as filed. Filing must be recorded by a " +
        "different user holding SUBMIT_GST_FILING (FRS Section 26, rule 5, applied to GST; Section 17.3's " +
        "prepare/submit split)."
    );
  }

  const extraData = {
    filedById: actingUser.id,
    filedAt: filedDate || new Date(),
  };
  if (referenceNo) extraData.referenceNo = referenceNo;

  await prisma.$transaction(async (tx) => {
    await applyPeriodChange(tx, { period, target: "FILED", actingUser, extraData, comment });
  });

  const result = await getPeriodSummary(periodId);
  result.warnings.push({
    code: "PERIOD_LOCKED",
    message:
      `${formatPeriodLabel(period)} is now read-only (FRS Section 26, rule 8). Documents dated inside it that ` +
      "are recorded from now on will be carried into the next open period.",
  });
  if (!referenceNo) {
    result.warnings.push({
      code: "NO_FILING_REFERENCE",
      message:
        "No filing reference/ARN was recorded. Add it later with PATCH /gst/periods/:periodId/acknowledge.",
    });
  }
  return result;
}

/**
 * FRS 17.2's final state, flagged there as needing client confirmation. It is
 * implemented as an OPTIONAL step after Filed and never as a requirement: a
 * company that does not track ARNs simply leaves its periods at Filed, and
 * nothing downstream treats that as incomplete.
 */
export async function acknowledgePeriod(actingUser, periodId, { referenceNo, acknowledgedDate, comment }) {
  const period = await loadPeriodOr404(periodId);
  assertPeriodTransition(period, "ACKNOWLEDGED");

  await prisma.$transaction(async (tx) => {
    await applyPeriodChange(tx, {
      period,
      target: "ACKNOWLEDGED",
      actingUser,
      extraData: { referenceNo, acknowledgedAt: acknowledgedDate || new Date() },
      comment,
    });
  });

  return getPeriodSummary(periodId);
}

// ---------------------------------------------------------------------------
// Cross-period summary -- FRS 22 "GST report / Tax summary", Section 21
// dashboards
// ---------------------------------------------------------------------------

/**
 * The same arithmetic as a period summary, over an arbitrary window, plus a
 * month-by-month series. Defaults to the current financial year to date when no
 * window is given, so the endpoint is useful without arguments.
 */
export async function getGstSummary({ from, to, periodYear }) {
  const where = {};
  if (periodYear) {
    where.filingPeriod = { periodYear };
  }
  if (from || to) {
    where.documentDate = {};
    if (from) where.documentDate.gte = from;
    if (to) where.documentDate.lte = to;
  }

  const rows = await prisma.gstTransaction.findMany({ where, include: { filingPeriod: true } });
  const summary = summariseTransactions(rows);

  // Grouped by the period the row was FILED under, not by its document date --
  // a late entry belongs to the return it will actually appear in.
  const byPeriod = new Map();
  for (const row of rows) {
    const label = row.filingPeriod ? formatPeriodLabel(row.filingPeriod) : "UNASSIGNED";
    if (!byPeriod.has(label)) {
      byPeriod.set(label, {
        period: label,
        status: row.filingPeriod ? row.filingPeriod.status : null,
        output: emptyLeg(),
        input: emptyLeg(),
      });
    }
    addInto(byPeriod.get(label)[row.direction === "OUTPUT" ? "output" : "input"], row);
  }

  const periods = [...byPeriod.values()]
    .map((p) => {
      const net = round2(p.output.totalTax - p.input.totalTax);
      return {
        ...p,
        net: { totalTax: net, payable: net > 0 ? net : 0, refundable: net < 0 ? round2(-net) : 0 },
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    filters: { from: from || null, to: to || null, periodYear: periodYear || null },
    companyGstin: env.companyGstin,
    summary,
    periods,
    warnings: registrationWarnings(),
  };
}

// ---------------------------------------------------------------------------
// Filing data -- FRS 17.2 "generate exportable report"
// ---------------------------------------------------------------------------

/**
 * The document-level workings behind a period, in the shape a CA or tax
 * consultant needs to key or import a return.
 *
 * It is deliberately NOT GSTR-1 or GSTR-3B JSON. Section 18 makes that a hard
 * boundary and Section 17.1 scopes this to "exportable for the company's CA/tax
 * consultant", so inventing a government schema here would be inventing a
 * requirement and would give false confidence that the output is submittable.
 * What it is instead: every taxable document in the period with its
 * counterparty, its GSTIN, its taxable value and its tax split.
 */
export async function getFilingData(periodId) {
  const period = await loadPeriodOr404(periodId);
  const rows = await prisma.gstTransaction.findMany({
    where: { filingPeriodId: periodId },
    orderBy: [{ direction: "asc" }, { documentDate: "asc" }],
    include: TRANSACTION_INCLUDE,
  });

  const summary = summariseTransactions(rows);
  const reconciliation = await reconcile(rows, periodWindow(period));

  const lines = rows.map((row) => {
    const doc = row.invoice || row.vendorBill;
    const counterparty = row.invoice ? row.invoice.client : row.vendorBill ? row.vendorBill.vendor : null;
    return {
      direction: row.direction,
      source: sourceOf(row),
      documentType: row.invoice ? "INVOICE" : row.vendorBill ? "VENDOR_BILL" : "ADJUSTMENT",
      documentNumber: row.invoice ? row.invoice.invoiceNumber : row.vendorBill ? row.vendorBill.billNumber : null,
      documentDate: row.documentDate,
      documentStatus: doc ? doc.status : null,
      counterpartyName: counterparty ? counterparty.name : null,
      counterpartyGstin: counterparty ? counterparty.gstin : null,
      placeOfSupply: placeOfSupplyOf(row),
      gstRate: num(row.gstRate),
      taxableAmount: num(row.taxableAmount),
      cgstAmount: num(row.cgstAmount),
      sgstAmount: num(row.sgstAmount),
      igstAmount: num(row.igstAmount),
      totalTax: totalTaxOf(row),
      note: row.note,
    };
  });

  const warnings = registrationWarnings();
  if (!reconciliation.balanced) {
    warnings.push({
      code: "RECONCILIATION_MISMATCH",
      message: "This export contains documents whose GST records do not match their own line items.",
    });
  }
  if (period.status !== "READY" && period.status !== "FILED" && period.status !== "ACKNOWLEDGED") {
    warnings.push({
      code: "PERIOD_NOT_READY",
      message:
        `This period is still ${period.status}. The export reflects the data as it stands now and may change ` +
        "before it is marked Ready.",
    });
  }

  return {
    // Named so no consumer can mistake this for a submittable return.
    format: "INTERNAL_WORKINGS_V1",
    disclaimer:
      "Internal working papers for the company's own CA/tax consultant. This is not a GSTR-1 or GSTR-3B " +
      "payload and this system does not submit anything to the GST portal (FRS Section 18).",
    companyGstin: env.companyGstin,
    period: shapePeriod(period),
    summary,
    reconciliation,
    lines,
    warnings,
  };
}

/** FRS 17.2's "Filing Record" view: the status board / filing history. */
export async function getFilingHistory({ skip, take }) {
  const [periods, totalCount] = await Promise.all([
    prisma.gstFilingPeriod.findMany({
      where: { status: { in: ["FILED", "ACKNOWLEDGED"] } },
      skip,
      take,
      orderBy: [{ filedAt: "desc" }],
    }),
    prisma.gstFilingPeriod.count({ where: { status: { in: ["FILED", "ACKNOWLEDGED"] } } }),
  ]);

  const actorIds = [
    ...new Set(periods.flatMap((p) => [p.preparedById, p.filedById]).filter(Boolean)),
  ];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    rows: periods.map((p) => ({
      ...shapePeriod(p),
      preparedBy: p.preparedById ? byId.get(p.preparedById) || { id: p.preparedById } : null,
      filedBy: p.filedById ? byId.get(p.filedById) || { id: p.filedById } : null,
    })),
    totalCount,
  };
}
