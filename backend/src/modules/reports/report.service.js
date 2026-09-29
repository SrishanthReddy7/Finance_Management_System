// Reports Module (FRS Section 22, 29.9).
//
// This module owns only the reports that no other module already produces:
// Revenue, Expense, Profit & Loss, Salary Expense, Employee Reimbursement,
// Project Profitability (list), Payment Transaction, Financial/Monthly
// Summary, Cash Flow. Client Outstanding / Invoice Aging / Client Payment
// live in invoice.service.js (mounted at /reports/ar/*), Vendor Payable in
// vendorBill.service.js (/reports/ap/*), GST report / Filing report / Tax
// summary in gst.service.js (/reports/gst/*), and Budget vs Actual in
// budget.service.js (/reports/budgets/*) -- all already built, already
// tested, and not duplicated here. The Financial Summary report below calls
// several of them directly rather than recomputing anything.
//
// Nothing here writes to the database (Section 22 reports are read-only), so
// there is no AuditLog traffic in this file -- Section 13's "don't audit
// normal GETs" instruction, and there is no export-generation state change
// either (CSV is rendered on the fly, nothing is persisted).
//
// Section 26 rule 10 still governs every figure: every total here is derived
// from the same status classifications (ACTUAL_EXPENSE_STATUSES,
// ACTUAL_BILL_STATUSES, REVENUE_INVOICE_STATUSES) the owning modules already
// use, imported rather than restated.

import { prisma } from "../../config/db.js";
import { buildCurrencyCaveats } from "../../utils/currency.js";
import { REVENUE_INVOICE_STATUSES } from "../invoice/invoice.constants.js";
import { ACTUAL_EXPENSE_STATUSES } from "../expenses/expense.constants.js";
import { ACTUAL_BILL_STATUSES } from "../vendors/vendorBill.constants.js";
import { resolveClaimVisibilityWhere } from "../expenses/expense.service.js";
import { getOutstandingReport } from "../invoice/invoice.service.js";
import { getPayableReport } from "../vendors/vendorBill.service.js";
import { getGstSummary } from "../gst/gst.service.js";
import { getBudgetSummary } from "../budgets/budget.service.js";
import { canViewAllProjectFinancials, getProjectProfitability } from "../projects/project.service.js";

// ---------------------------------------------------------------------------
// Small numeric / date helpers -- Prisma hands back Decimal, not Number.
// ---------------------------------------------------------------------------

const num = (value) => (value == null ? 0 : Number(value));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Defaults an unbounded [from,to] to the current calendar month -- used only
 * by the reports explicitly framed as periodic ("Monthly Financial Summary",
 * Cash Flow). Every other report in this file stays unbounded (all-time) when
 * no range is given, matching the AR/AP/GST reports' own convention.
 */
function resolveMonthRange(from, to) {
  if (from || to) {
    return { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null };
  }
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  };
}

/** Is a Payslip's (periodYear, periodMonth) inside an optional [from,to] range? */
function periodInRange(periodYear, periodMonth, from, to) {
  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  if (from && periodStart < startOfUtcDay(from)) return false;
  if (to && periodStart > startOfUtcDay(to)) return false;
  return true;
}

/** Generic "sum one numeric field, grouped by an {id,...} key object" rollup. */
function rollupBy(rows, keyFn, amountField) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const entry = map.get(key.id) || { ...key, count: 0, total: 0 };
    entry.count += 1;
    entry.total = round2(entry.total + num(row[amountField]));
    map.set(key.id, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Same shape, for Salary Expense's three-figure (gross/deductions/net) rollup. */
function rollupSalary(payslips, keyFn) {
  const map = new Map();
  for (const p of payslips) {
    const key = keyFn(p);
    if (!key) continue;
    const entry = map.get(key.id) || { ...key, payslipCount: 0, grossEarnings: 0, totalDeductions: 0, netSalary: 0 };
    entry.payslipCount += 1;
    entry.grossEarnings = round2(entry.grossEarnings + num(p.grossEarnings));
    entry.totalDeductions = round2(entry.totalDeductions + num(p.totalDeductions));
    entry.netSalary = round2(entry.netSalary + num(p.netSalary));
    map.set(key.id, entry);
  }
  return [...map.values()].sort((a, b) => b.netSalary - a.netSalary);
}

// ---------------------------------------------------------------------------
// Revenue (FRS 22 GREEN list)
// ---------------------------------------------------------------------------

/** Reuses the exact statuses Project profitability counts as billed revenue. */
export async function getRevenueReport({ from, to, clientId, projectId, currency }) {
  const where = { status: { in: REVENUE_INVOICE_STATUSES } };
  if (from || to) {
    where.invoiceDate = {};
    if (from) where.invoiceDate.gte = startOfUtcDay(from);
    if (to) where.invoiceDate.lte = startOfUtcDay(to);
  }
  if (clientId) where.clientId = clientId;
  if (projectId) where.projectId = projectId;
  if (currency) where.currency = currency;

  const invoices = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      invoiceDate: true,
      currency: true,
      totalAmount: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  const rows = invoices.map((inv) => ({ ...inv, totalAmount: round2(num(inv.totalAmount)) }));

  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: { invoiceCount: rows.length, totalRevenue: round2(rows.reduce((s, r) => s + r.totalAmount, 0)) },
    byClient: rollupBy(
      rows.filter((r) => r.client),
      (r) => r.client,
      "totalAmount"
    ),
    byProject: rollupBy(
      rows.filter((r) => r.project),
      (r) => r.project,
      "totalAmount"
    ),
    invoices: rows,
    caveats: buildCurrencyCaveats(rows),
  };
}

// ---------------------------------------------------------------------------
// Expense (FRS 22 GREEN list)
// ---------------------------------------------------------------------------

/** Reuses ACTUAL_EXPENSE_STATUSES -- the same "approved = actual spend" rule Budgets/Projects already apply. */
export async function getExpenseReport({ from, to, projectId, categoryId, departmentId }) {
  const where = { status: { in: ACTUAL_EXPENSE_STATUSES } };
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = startOfUtcDay(from);
    if (to) where.expenseDate.lte = startOfUtcDay(to);
  }
  if (projectId) where.projectId = projectId;
  if (categoryId) where.categoryId = categoryId;
  if (departmentId) where.employee = { departmentId };

  const claims = await prisma.expenseClaim.findMany({
    where,
    select: {
      id: true,
      amount: true,
      expenseDate: true,
      status: true,
      category: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      employee: {
        select: { id: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
      },
    },
    orderBy: { expenseDate: "desc" },
  });

  const rows = claims.map((c) => ({
    id: c.id,
    amount: round2(num(c.amount)),
    expenseDate: c.expenseDate,
    status: c.status,
    category: c.category,
    project: c.project,
    employee: { id: c.employee.id, name: `${c.employee.firstName} ${c.employee.lastName}` },
    department: c.employee.department,
  }));

  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: { claimCount: rows.length, totalExpense: round2(rows.reduce((s, r) => s + r.amount, 0)) },
    byCategory: rollupBy(rows, (r) => r.category, "amount"),
    byProject: rollupBy(
      rows.filter((r) => r.project),
      (r) => r.project,
      "amount"
    ),
    byDepartment: rollupBy(
      rows.filter((r) => r.department),
      (r) => r.department,
      "amount"
    ),
    claims: rows,
  };
}

// ---------------------------------------------------------------------------
// Profit & Loss (FRS 22 GREEN list) -- shared with the Financial Summary
// ---------------------------------------------------------------------------

/**
 * Revenue - (Expenses + Vendor Bills + Payroll). Every figure is the same
 * "actual" classification the owning module already uses: REVENUE_INVOICE_
 * STATUSES (Invoicing), ACTUAL_EXPENSE_STATUSES (Expenses), ACTUAL_BILL_
 * STATUSES (Vendors/AP). Payroll cost counts once a run is FINALIZED (the
 * point it becomes the immutable official record), matching "approved, not
 * necessarily yet paid, still counts as a real cost" for the other two.
 *
 * There is no double-entry ledger in this system (Section 3 explicitly
 * excludes one), so this is a cash-basis-adjacent approximation built purely
 * from records that already exist -- not a second accounting engine.
 */
async function computeProfitLoss({ from, to }) {
  const dateRange = (field) => {
    if (!from && !to) return {};
    const range = {};
    if (from) range.gte = startOfUtcDay(from);
    if (to) range.lte = startOfUtcDay(to);
    return { [field]: range };
  };

  const [invoiceGroups, expenseAgg, billGroups, payslips] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["currency"],
      where: { status: { in: REVENUE_INVOICE_STATUSES }, ...dateRange("invoiceDate") },
      _sum: { totalAmount: true },
    }),
    prisma.expenseClaim.aggregate({
      where: { status: { in: ACTUAL_EXPENSE_STATUSES }, ...dateRange("expenseDate") },
      _sum: { amount: true },
    }),
    prisma.vendorBill.groupBy({
      by: ["currency"],
      where: { status: { in: ACTUAL_BILL_STATUSES }, ...dateRange("billDate") },
      _sum: { totalAmount: true },
    }),
    // Payslip has no date column to range-filter directly (only the
    // periodMonth/periodYear pair), and FINALIZED/PAID payroll runs are
    // expected to be a modest row count (Section 33 NFR) -- filtering the
    // small remainder in memory keeps this one query instead of an OR-of-
    // months query that would be harder to read for no real benefit.
    prisma.payslip.findMany({
      where: { payrollRun: { status: { in: ["FINALIZED", "PAID"] } } },
      select: { netSalary: true, periodMonth: true, periodYear: true },
    }),
  ]);

  const revenue = round2(invoiceGroups.reduce((s, g) => s + num(g._sum.totalAmount), 0));
  const expenses = round2(num(expenseAgg._sum.amount));
  const vendorBills = round2(billGroups.reduce((s, g) => s + num(g._sum.totalAmount), 0));
  const payroll = round2(
    payslips
      .filter((p) => periodInRange(p.periodYear, p.periodMonth, from, to))
      .reduce((s, p) => s + num(p.netSalary), 0)
  );

  const totalCost = round2(expenses + vendorBills + payroll);
  const profit = round2(revenue - totalCost);

  const caveats = [
    ...buildCurrencyCaveats(invoiceGroups).map((c) => `Revenue: ${c}`),
    ...buildCurrencyCaveats(billGroups).map((c) => `Vendor bills: ${c}`),
    "Expenses and payroll are recorded without a currency field in this system and are assumed to be in the company's base currency.",
  ];
  if (payroll > 0) {
    caveats.push("Payroll cost counts once a payroll run is FINALIZED, not when it is actually paid out.");
  }

  return { revenue, costs: { expenses, vendorBills, payroll, total: totalCost }, profit, marginPercent: revenue === 0 ? null : round2((profit / revenue) * 100), caveats };
}

export async function getProfitLossReport({ from, to }) {
  const result = await computeProfitLoss({ from, to });
  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    ...result,
    breakdown: [
      { component: "Revenue", amount: result.revenue },
      { component: "Expenses", amount: -result.costs.expenses },
      { component: "Vendor Bills", amount: -result.costs.vendorBills },
      { component: "Payroll", amount: -result.costs.payroll },
      { component: "Profit", amount: result.profit },
    ],
  };
}

// ---------------------------------------------------------------------------
// Salary Expense (FRS 22 GREEN list). Access resolved as VIEW_FINANCIAL_
// REPORTS OR VIEW_COMPANY_SALARY (route layer) -- aggregate figures only,
// never a per-employee row, so this never needs a per-row salary check
// (Section 21: "a team salary total tile is fine even where individual
// breakdown isn't allowed").
// ---------------------------------------------------------------------------

export async function getSalaryExpenseReport({ periodYear, periodMonth, departmentId }) {
  const where = {};
  if (periodYear) where.periodYear = periodYear;
  if (periodMonth) where.periodMonth = periodMonth;
  if (departmentId) where.employee = { departmentId };

  const payslips = await prisma.payslip.findMany({
    where,
    select: {
      employeeId: true,
      grossEarnings: true,
      totalDeductions: true,
      netSalary: true,
      periodMonth: true,
      periodYear: true,
      employee: { select: { department: { select: { id: true, name: true } } } },
    },
  });

  const summary = {
    payslipCount: payslips.length,
    employeeCount: new Set(payslips.map((p) => p.employeeId)).size,
    grossEarnings: round2(payslips.reduce((s, p) => s + num(p.grossEarnings), 0)),
    totalDeductions: round2(payslips.reduce((s, p) => s + num(p.totalDeductions), 0)),
    netSalary: round2(payslips.reduce((s, p) => s + num(p.netSalary), 0)),
  };

  const byDepartment = rollupSalary(payslips, (p) => p.employee.department);
  const byPeriod = rollupSalary(payslips, (p) => ({
    id: `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
    periodYear: p.periodYear,
    periodMonth: p.periodMonth,
  }));

  const withoutDepartment = payslips.filter((p) => !p.employee.department).length;
  const caveats = [
    "This report shows aggregate figures only -- no individual employee's salary is disclosed here (FRS Section 8).",
  ];
  if (withoutDepartment > 0) {
    caveats.push(
      `${withoutDepartment} payslip(s) belong to an employee with no department assigned and are excluded from the department breakdown (still included in the overall summary).`
    );
  }

  return {
    filters: { periodYear: periodYear || null, periodMonth: periodMonth || null, departmentId: departmentId || null },
    summary,
    byDepartment,
    byPeriod,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Employee Reimbursement (FRS 22 GREEN list: "role-scoped like expenses",
// i.e. Section 8's self/hierarchy pattern -- reuses expense.service's own
// scoping rule rather than a second copy of it).
// ---------------------------------------------------------------------------

export async function getReimbursementReport(actingUser, { from, to, employeeId, departmentId, status }) {
  const scopeWhere = await resolveClaimVisibilityWhere(actingUser);
  if (scopeWhere === null) {
    return { period: { from: from || null, to: to || null }, summary: { count: 0, totalReimbursed: 0, totalPending: 0 }, byEmployee: [], reimbursements: [] };
  }

  const claimWhere = { ...scopeWhere };
  if (employeeId) claimWhere.employeeId = employeeId;
  if (departmentId) claimWhere.employee = { departmentId };

  const reimbursementWhere = {
    expenseClaim: claimWhere,
    ...(status ? { paymentStatus: status } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: startOfUtcDay(from) } : {}), ...(to ? { lte: startOfUtcDay(to) } : {}) } }
      : {}),
  };

  const reimbursements = await prisma.reimbursement.findMany({
    where: reimbursementWhere,
    select: {
      id: true,
      amount: true,
      paymentStatus: true,
      paidAt: true,
      method: true,
      referenceNo: true,
      createdAt: true,
      expenseClaim: {
        select: {
          category: { select: { id: true, name: true } },
          employee: {
            select: { id: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = reimbursements.map((r) => ({
    id: r.id,
    amount: round2(num(r.amount)),
    paymentStatus: r.paymentStatus,
    paidAt: r.paidAt,
    method: r.method,
    referenceNo: r.referenceNo,
    createdAt: r.createdAt,
    category: r.expenseClaim.category,
    employee: { id: r.expenseClaim.employee.id, name: `${r.expenseClaim.employee.firstName} ${r.expenseClaim.employee.lastName}` },
    department: r.expenseClaim.employee.department,
  }));

  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: {
      count: rows.length,
      totalReimbursed: round2(rows.filter((r) => r.paymentStatus === "PAID").reduce((s, r) => s + r.amount, 0)),
      totalPending: round2(rows.filter((r) => r.paymentStatus !== "PAID").reduce((s, r) => s + r.amount, 0)),
    },
    byEmployee: rollupBy(rows, (r) => r.employee, "amount"),
    reimbursements: rows,
  };
}

// ---------------------------------------------------------------------------
// Project Profitability -- list (FRS 22 GREEN list). Reuses
// getProjectProfitability's EXACT per-project calculation and salary
// redaction; this only decides which projects are visible and loops.
// ---------------------------------------------------------------------------

export async function getProjectProfitabilityReport(actingUser, { status, clientId, projectManagerId, skip, take }) {
  const filters = [];
  if (!canViewAllProjectFinancials(actingUser)) {
    // Same narrow rule as the single-project endpoint (Section 29.5): plain
    // project visibility/MANAGE_PROJECTS is NOT enough here, because
    // profitability exposes implied labour/salary cost. Only the project's
    // own assigned manager, without VIEW_FINANCIAL_REPORTS, sees anything.
    if (!actingUser.employee) return { rows: [], totalCount: 0 };
    filters.push({ projectManagerId: actingUser.employee.id });
  }
  if (status) filters.push({ status });
  if (clientId) filters.push({ clientId });
  if (projectManagerId) filters.push({ projectManagerId });

  const where = filters.length > 0 ? { AND: filters } : {};

  const [projectIds, totalCount] = await Promise.all([
    prisma.project.findMany({ where, skip, take, select: { id: true }, orderBy: { startDate: "desc" } }),
    prisma.project.count({ where }),
  ]);

  const rows = await Promise.all(projectIds.map((p) => getProjectProfitability(actingUser, p.id)));
  return { rows, totalCount };
}

// ---------------------------------------------------------------------------
// Payment Transaction (FRS 22 GREEN list). Union of already-recorded
// payments -- ClientPayment, VendorPayment, Payslip payouts, and (Stage 12)
// PROCESSED PaymentRefund rows -- nothing recomputed.
//
// Stage 12 (approved refund-reporting design): a PROCESSED refund is added
// as its own row, direction REFUND, rather than netted against the original
// ClientPayment row -- ClientPayment.amount is never touched (it stays the
// historical fact "this much was received"), and the refund is fully
// traceable back to it via sourceRef. Only PROCESSED refunds are completed
// cash movements; REQUESTED/PROCESSING/FAILED/CANCELLED are excluded
// entirely (they are not money that has actually moved).
// ---------------------------------------------------------------------------

export async function getPaymentTransactionReport(actingUser, { from, to, direction, currency }) {
  const dateRange = (field) => {
    if (!from && !to) return {};
    const range = {};
    if (from) range.gte = startOfUtcDay(from);
    if (to) range.lte = startOfUtcDay(to);
    return { [field]: range };
  };

  // Rewritten as a positive allow-list (was an exclusion-list before Stage
  // 12) so a 4th direction value can't silently fall through every check --
  // no filter means every direction is included, same as before.
  const includeIn = !direction || direction === "IN";
  const includeOut = !direction || direction === "OUT";
  const includePayrollDirection = !direction || direction === "PAYROLL";
  const includeRefund = !direction || direction === "REFUND";

  const [clientPayments, vendorPayments, processedRefunds] = await Promise.all([
    includeIn
      ? prisma.clientPayment.findMany({
          where: dateRange("paymentDate"),
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            method: true,
            referenceNo: true,
            invoice: { select: { invoiceNumber: true, currency: true, client: { select: { id: true, name: true } } } },
          },
          orderBy: { paymentDate: "desc" },
        })
      : [],
    includeOut
      ? prisma.vendorPayment.findMany({
          where: dateRange("paymentDate"),
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            method: true,
            referenceNo: true,
            vendorBill: { select: { billNumber: true, currency: true, vendor: { select: { id: true, name: true } } } },
          },
          orderBy: { paymentDate: "desc" },
        })
      : [],
    // Stage 12: only PROCESSED refunds are real cash movements. PaymentRefund
    // has no dedicated "processed date" column (Stage 9's schema, unchanged
    // this stage) -- `updatedAt` is used instead, which is semantically safe
    // specifically because PROCESSED is a terminal status (Stage 11): once a
    // refund reaches PROCESSED it is never written again, so `updatedAt` at
    // read time IS the moment it became PROCESSED, not some later unrelated
    // edit. See the Handsoff Stage 12 entry for why this doesn't need a new
    // schema field.
    includeRefund
      ? prisma.paymentRefund.findMany({
          where: { status: "PROCESSED", ...dateRange("updatedAt") },
          select: {
            id: true,
            amount: true,
            currency: true,
            gatewayRefundId: true,
            updatedAt: true,
            clientPayment: {
              select: { invoice: { select: { invoiceNumber: true, client: { select: { id: true, name: true } } } } },
            },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [],
  ]);

  let rows = [
    ...clientPayments.map((p) => ({
      id: p.id,
      direction: "IN",
      date: p.paymentDate,
      amount: round2(num(p.amount)),
      currency: p.invoice.currency,
      method: p.method,
      referenceNo: p.referenceNo,
      counterparty: p.invoice.client?.name ?? null,
      sourceType: "Invoice",
      sourceRef: p.invoice.invoiceNumber,
    })),
    ...vendorPayments.map((p) => ({
      id: p.id,
      direction: "OUT",
      date: p.paymentDate,
      amount: round2(num(p.amount)),
      currency: p.vendorBill.currency,
      method: p.method,
      referenceNo: p.referenceNo,
      counterparty: p.vendorBill.vendor?.name ?? null,
      sourceType: "VendorBill",
      sourceRef: p.vendorBill.billNumber,
    })),
    ...processedRefunds.map((r) => ({
      id: r.id,
      direction: "REFUND",
      date: r.updatedAt,
      amount: round2(num(r.amount)),
      currency: r.currency,
      method: "RAZORPAY",
      referenceNo: r.gatewayRefundId,
      counterparty: r.clientPayment.invoice.client?.name ?? null,
      sourceType: "ClientPayment",
      sourceRef: r.clientPayment.invoice.invoiceNumber,
    })),
  ];

  // Every payroll payout row names an employee and their net salary -- that
  // is individual salary data (Section 8), which this report's own gate
  // (VIEW_FINANCIAL_REPORTS, a company-wide REPORTING permission) does not by
  // itself grant. Included only for a caller who separately holds salary
  // visibility; otherwise the rows are simply left out, with a caveat saying
  // so, rather than exposing them or blocking the rest of the report.
  let payrollNote = null;
  if (includePayrollDirection) {
    const canSeePayroll = actingUser.roleType === "SUPER_ADMIN" || actingUser.permissionCodes?.includes("VIEW_COMPANY_SALARY");
    if (canSeePayroll) {
      const payslipPayments = await prisma.payslip.findMany({
        where: { paymentStatus: "PAID", ...dateRange("paidAt") },
        select: {
          id: true,
          netSalary: true,
          paidAt: true,
          paymentMethod: true,
          paymentReferenceNo: true,
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: { paidAt: "desc" },
      });
      rows.push(
        ...payslipPayments.map((p) => ({
          id: p.id,
          direction: "PAYROLL",
          date: p.paidAt,
          amount: round2(num(p.netSalary)),
          // Payslip carries no currency column -- the company's base
          // currency is assumed throughout Payroll (see Salaries/Payroll's
          // own doc comments).
          currency: "INR",
          method: p.paymentMethod,
          referenceNo: p.paymentReferenceNo,
          counterparty: `${p.employee.firstName} ${p.employee.lastName}`,
          sourceType: "Payslip",
          sourceRef: p.id,
        }))
      );
    } else {
      payrollNote = "Payroll payments are excluded from this report because you do not hold salary-visibility access (VIEW_COMPANY_SALARY).";
    }
  }

  if (currency) rows = rows.filter((r) => r.currency === currency);
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalIn = round2(rows.filter((r) => r.direction === "IN").reduce((s, r) => s + r.amount, 0));
  const totalOut = round2(rows.filter((r) => r.direction === "OUT").reduce((s, r) => s + r.amount, 0));
  const totalPayroll = round2(rows.filter((r) => r.direction === "PAYROLL").reduce((s, r) => s + r.amount, 0));
  // Stage 12: refunds are their own outflow total, subtracted in
  // netCashMovement exactly like totalOut/totalPayroll already are -- never
  // netted against totalIn (ClientPayment inflow rows are untouched).
  const totalRefunds = round2(rows.filter((r) => r.direction === "REFUND").reduce((s, r) => s + r.amount, 0));

  const caveats = buildCurrencyCaveats(rows);
  if (payrollNote) caveats.push(payrollNote);
  if (totalRefunds > 0) {
    caveats.push(
      "Refund rows use the refund's last-updated timestamp as its processed date (PROCESSED is a terminal status, so this is the moment it was confirmed)."
    );
  }

  return {
    period: { from: from ? startOfUtcDay(from) : null, to: to ? startOfUtcDay(to) : null },
    summary: {
      transactionCount: rows.length,
      totalIn,
      totalOut,
      totalPayroll,
      totalRefunds,
      netCashMovement: round2(totalIn - totalOut - totalPayroll - totalRefunds),
    },
    transactions: rows,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Financial Summary (FRS 22 GREEN "Monthly Financial Summary" + the general
// company financial summary). Composes the P&L above with the ALREADY-BUILT
// AR/AP/GST/Budget reports -- nothing here recalculates any of those.
// ---------------------------------------------------------------------------

export async function getFinancialSummaryReport(actingUser, { from, to, compare }) {
  const range = resolveMonthRange(from, to);

  const [pl, receivables, payables, gst, budget, cashFlow] = await Promise.all([
    computeProfitLoss({ from: range.from, to: range.to }),
    getOutstandingReport({ asOf: range.to || undefined }),
    getPayableReport({ from: range.from, to: range.to, asOf: range.to || undefined }),
    getGstSummary({ from: range.from, to: range.to }),
    getBudgetSummary(actingUser, {}),
    // Stage 12: this report has no cash-movement figures of its own to begin
    // with (revenue/expenses/profit here are accrual, from invoices/bills/
    // payroll, not recorded payment events) -- so a PROCESSED refund cannot
    // be "subtracted from revenue" without inventing a rule the FRS/Stage 8
    // design never asked for. Instead this composes the ALREADY-refund-aware
    // Cash Flow Summary above (same reuse-not-recompute pattern this report
    // already uses for AR/AP/GST/Budget), so refund cash movement is visible
    // here without touching revenue/profit/receivables/payables at all.
    getCashFlowReport({ from: range.from, to: range.to }),
  ]);

  let comparison = null;
  if (compare && range.from && range.to) {
    const spanMs = range.to.getTime() - range.from.getTime();
    const prevTo = new Date(range.from.getTime() - 24 * 60 * 60 * 1000);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    const prevPl = await computeProfitLoss({ from: prevFrom, to: prevTo });
    comparison = {
      period: { from: prevFrom, to: prevTo },
      revenue: prevPl.revenue,
      expenses: prevPl.costs.total,
      profit: prevPl.profit,
    };
  }

  return {
    period: range,
    revenue: pl.revenue,
    expenses: pl.costs,
    profit: pl.profit,
    marginPercent: pl.marginPercent,
    receivables: { totalOutstanding: receivables.summary.totalOutstanding, overdueOutstanding: receivables.summary.overdueOutstanding },
    payables: { totalOutstanding: payables.summary.totalOutstanding, overdueOutstanding: payables.summary.overdueOutstanding },
    gst: {
      netPayable: gst.summary.net.payable,
      netRefundable: gst.summary.net.refundable,
      outputTax: gst.summary.output.totalTax,
      inputTax: gst.summary.input.totalTax,
    },
    budget: { plannedAmount: budget.summary.plannedAmount, actual: budget.summary.actual, utilizationPercent: budget.summary.utilizationPercent },
    // Stage 12: cash movement, not accrual -- deliberately separate from
    // `revenue`/`expenses`/`profit` above, which stay invoice/bill/payroll
    // accrual figures exactly as before. `cashOutRefunds` is the same number
    // Cash Flow Summary computes; not recalculated here.
    cashFlow: {
      cashIn: cashFlow.summary.cashIn,
      cashOut: cashFlow.summary.cashOut,
      cashOutRefunds: cashFlow.summary.cashOutRefunds,
      netCashFlow: cashFlow.summary.netCashFlow,
    },
    comparison,
    breakdown: [
      { component: "Revenue", amount: pl.revenue },
      { component: "Expenses", amount: -pl.costs.total },
      { component: "Profit", amount: pl.profit },
      { component: "Receivables Outstanding", amount: receivables.summary.totalOutstanding },
      { component: "Payables Outstanding", amount: -payables.summary.totalOutstanding },
      { component: "GST Net Payable", amount: -gst.summary.net.payable },
      { component: "Refund Cash Outflow", amount: -cashFlow.summary.cashOutRefunds },
    ],
    caveats: [...pl.caveats, ...receivables.caveats, ...payables.caveats, ...cashFlow.caveats],
  };
}

// ---------------------------------------------------------------------------
// Cash Flow Summary (FRS 22 GREEN list). Strictly payment-dated (money that
// actually moved, per the recorded payment tables) -- deliberately different
// from the accrual-ish Revenue/P&L figures above.
// ---------------------------------------------------------------------------

export async function getCashFlowReport({ from, to }) {
  const range = resolveMonthRange(from, to);
  const dateRange = (field) => {
    const r = {};
    if (range.from) r.gte = range.from;
    if (range.to) r.lte = range.to;
    return { [field]: r };
  };

  const [clientPayments, vendorPayments, payslipPayments, processedRefunds] = await Promise.all([
    prisma.clientPayment.findMany({ where: dateRange("paymentDate"), select: { amount: true, paymentDate: true } }),
    prisma.vendorPayment.findMany({ where: dateRange("paymentDate"), select: { amount: true, paymentDate: true } }),
    prisma.payslip.findMany({
      where: { paymentStatus: "PAID", ...dateRange("paidAt") },
      select: { netSalary: true, paidAt: true },
    }),
    // Stage 12: a PROCESSED PaymentRefund is real money leaving the company
    // and belongs in cash outflow, same as VendorPayment/Payslip payouts --
    // REQUESTED/PROCESSING/FAILED/CANCELLED are not completed cash
    // movements and are correctly excluded by this `status: "PROCESSED"`
    // filter. `updatedAt` stands in for a "processed date" (PaymentRefund
    // has no dedicated column for one) -- safe specifically because
    // PROCESSED is terminal (Stage 11), so it is never written again after
    // becoming PROCESSED.
    prisma.paymentRefund.findMany({
      where: { status: "PROCESSED", ...dateRange("updatedAt") },
      select: { amount: true, updatedAt: true },
    }),
  ]);

  const cashIn = round2(clientPayments.reduce((s, p) => s + num(p.amount), 0));
  const cashOutVendors = round2(vendorPayments.reduce((s, p) => s + num(p.amount), 0));
  // Aggregate only -- a plain sum discloses no individual salary (Section 21),
  // so this is safe to include for any VIEW_FINANCIAL_REPORTS holder, unlike
  // the row-level payroll entries in the Payment Transaction report above.
  const cashOutPayroll = round2(payslipPayments.reduce((s, p) => s + num(p.netSalary), 0));
  const cashOutRefunds = round2(processedRefunds.reduce((s, r) => s + num(r.amount), 0));
  const cashOut = round2(cashOutVendors + cashOutPayroll + cashOutRefunds);

  const bucketKey = (date) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const byMonth = new Map();
  const addToBucket = (date, field, amount) => {
    const key = bucketKey(date);
    const entry = byMonth.get(key) || { period: key, cashIn: 0, cashOut: 0 };
    entry[field] = round2(entry[field] + amount);
    byMonth.set(key, entry);
  };
  for (const p of clientPayments) addToBucket(p.paymentDate, "cashIn", num(p.amount));
  for (const p of vendorPayments) addToBucket(p.paymentDate, "cashOut", num(p.amount));
  for (const p of payslipPayments) addToBucket(p.paidAt, "cashOut", num(p.netSalary));
  for (const r of processedRefunds) addToBucket(r.updatedAt, "cashOut", num(r.amount));

  const caveats = [
    "Cash flow reflects recorded payment events only (ClientPayment/VendorPayment/Payslip payouts/processed refunds), not invoiced or billed amounts that have not been paid yet -- see the Revenue / Profit & Loss reports for accrual-basis figures.",
  ];
  if (cashOutRefunds > 0) {
    caveats.push(
      "Refund cash outflow uses each refund's last-updated timestamp as its processed date (PROCESSED is a terminal status, so this is the moment it was confirmed, not a separately-tracked processing date)."
    );
  }

  return {
    period: range,
    summary: { cashIn, cashOut, cashOutVendors, cashOutPayroll, cashOutRefunds, netCashFlow: round2(cashIn - cashOut) },
    byPeriod: [...byMonth.values()].sort((a, b) => a.period.localeCompare(b.period)),
    caveats,
  };
}
