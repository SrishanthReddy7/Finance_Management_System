// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission checks live here (they are on the
// routes and in the service respectively), matching every other module.

import * as budgetService from "./budget.service.js";
import {
  createBudgetSchema,
  updateBudgetSchema,
  setBudgetStatusSchema,
  budgetIdParamSchema,
  listBudgetsQuerySchema,
  budgetSummaryQuerySchema,
} from "./budget.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listBudgetsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listBudgetsQuerySchema.parse(req.query);
    const { rows, totalCount } = await budgetService.listBudgets(req.user, { ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getBudgetHandler(req, res, next) {
  try {
    const { id } = budgetIdParamSchema.parse(req.params);
    return ok(res, await budgetService.getBudgetOr404(req.user, id));
  } catch (err) {
    next(err);
  }
}

export async function getBudgetUtilizationHandler(req, res, next) {
  try {
    const { id } = budgetIdParamSchema.parse(req.params);
    return ok(res, await budgetService.getBudgetUtilization(req.user, id));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createBudgetHandler(req, res, next) {
  try {
    const body = createBudgetSchema.parse(req.body);
    return created(res, await budgetService.createBudget(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateBudgetHandler(req, res, next) {
  try {
    const { id } = budgetIdParamSchema.parse(req.params);
    const body = updateBudgetSchema.parse(req.body);
    return ok(res, await budgetService.updateBudget(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function setBudgetStatusHandler(req, res, next) {
  try {
    const { id } = budgetIdParamSchema.parse(req.params);
    const body = setBudgetStatusSchema.parse(req.body);
    return ok(res, await budgetService.setBudgetStatus(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Summary (FRS 22 "Budget vs Actual")
// ---------------------------------------------------------------------------

export async function budgetSummaryHandler(req, res, next) {
  try {
    const query = budgetSummaryQuerySchema.parse(req.query);
    return ok(res, await budgetService.getBudgetSummary(req.user, query));
  } catch (err) {
    next(err);
  }
}
