// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope
// (or, when `?format=csv` is given, a CSV file download instead -- see
// utils/csv.js). No business rules and no permission checks live here (they
// are on the routes and in the service respectively), matching every other
// module.

import * as reportService from "./report.service.js";
import {
  revenueReportQuerySchema,
  expenseReportQuerySchema,
  profitLossQuerySchema,
  salaryExpenseReportQuerySchema,
  reimbursementReportQuerySchema,
  projectProfitabilityReportQuerySchema,
  paymentTransactionReportQuerySchema,
  financialSummaryQuerySchema,
  cashFlowReportQuerySchema,
} from "./report.validation.js";
import { ok } from "../../utils/apiResponse.js";
import { sendCsv } from "../../utils/csv.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

/** `csvRows` is whichever array within `data` is the right flat shape for a spreadsheet. */
function respond(req, res, data, csvRows, filename) {
  if (req.query.format === "csv") {
    return sendCsv(res, filename, csvRows || []);
  }
  return ok(res, data);
}

/**
 * Several reports carry nested {id,name} relation objects (client, project,
 * category, employee, department) that are fine in JSON but render as an
 * unreadable JSON blob in a CSV cell. This flattens the named fields to just
 * their `.name` for the CSV export only -- the JSON response is unaffected.
 */
function flattenNames(rows, fields) {
  return rows.map((row) => {
    const flat = { ...row };
    for (const field of fields) {
      flat[field] = row[field]?.name ?? null;
    }
    return flat;
  });
}

export async function revenueReportHandler(req, res, next) {
  try {
    const query = revenueReportQuerySchema.parse(req.query);
    const data = await reportService.getRevenueReport(query);
    return respond(req, res, data, flattenNames(data.invoices, ["client", "project"]), "revenue-report.csv");
  } catch (err) {
    next(err);
  }
}

export async function expenseReportHandler(req, res, next) {
  try {
    const query = expenseReportQuerySchema.parse(req.query);
    const data = await reportService.getExpenseReport(query);
    return respond(
      req,
      res,
      data,
      flattenNames(data.claims, ["category", "project", "employee", "department"]),
      "expense-report.csv"
    );
  } catch (err) {
    next(err);
  }
}

export async function profitLossReportHandler(req, res, next) {
  try {
    const query = profitLossQuerySchema.parse(req.query);
    const data = await reportService.getProfitLossReport(query);
    return respond(req, res, data, data.breakdown, "profit-loss-report.csv");
  } catch (err) {
    next(err);
  }
}

export async function salaryExpenseReportHandler(req, res, next) {
  try {
    const query = salaryExpenseReportQuerySchema.parse(req.query);
    const data = await reportService.getSalaryExpenseReport(query);
    // CSV export uses the department rollup only -- never a per-employee row,
    // matching the report's own no-individual-salary design.
    return respond(req, res, data, data.byDepartment, "salary-expense-report.csv");
  } catch (err) {
    next(err);
  }
}

export async function reimbursementReportHandler(req, res, next) {
  try {
    const query = reimbursementReportQuerySchema.parse(req.query);
    const data = await reportService.getReimbursementReport(req.user, query);
    return respond(
      req,
      res,
      data,
      flattenNames(data.reimbursements, ["category", "employee", "department"]),
      "employee-reimbursement-report.csv"
    );
  } catch (err) {
    next(err);
  }
}

export async function projectProfitabilityReportHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = projectProfitabilityReportQuerySchema.parse(req.query);
    const { rows, totalCount } = await reportService.getProjectProfitabilityReport(req.user, { ...filters, skip, take });

    if (req.query.format === "csv") {
      const csvRows = rows.map((r) => ({
        projectId: r.projectId,
        name: r.name,
        status: r.status,
        client: r.client?.name ?? null,
        currency: r.currency,
        billedRevenue: r.revenue.billed,
        totalCost: r.cost.total,
        profit: r.profitability.profit,
        marginPercent: r.profitability.marginPercent,
      }));
      return sendCsv(res, "project-profitability-report.csv", csvRows);
    }
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function paymentTransactionReportHandler(req, res, next) {
  try {
    const query = paymentTransactionReportQuerySchema.parse(req.query);
    const data = await reportService.getPaymentTransactionReport(req.user, query);
    return respond(req, res, data, data.transactions, "payment-transaction-report.csv");
  } catch (err) {
    next(err);
  }
}

export async function financialSummaryReportHandler(req, res, next) {
  try {
    const query = financialSummaryQuerySchema.parse(req.query);
    const data = await reportService.getFinancialSummaryReport(req.user, query);
    return respond(req, res, data, data.breakdown, "financial-summary-report.csv");
  } catch (err) {
    next(err);
  }
}

export async function cashFlowReportHandler(req, res, next) {
  try {
    const query = cashFlowReportQuerySchema.parse(req.query);
    const data = await reportService.getCashFlowReport(query);
    return respond(req, res, data, data.byPeriod, "cash-flow-report.csv");
  } catch (err) {
    next(err);
  }
}
