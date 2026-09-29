// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission checks live here (they are on the routes
// and in the service respectively), matching every other module.

import * as gstService from "./gst.service.js";
import {
  listGstTransactionsQuerySchema,
  createAdjustmentSchema,
  createPeriodSchema,
  listPeriodsQuerySchema,
  periodIdParamSchema,
  gstTransactionIdParamSchema,
  preparePeriodSchema,
  markFiledSchema,
  acknowledgeSchema,
  gstSummaryQuerySchema,
} from "./gst.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export async function configHandler(req, res, next) {
  try {
    return ok(res, await gstService.getGstConfig());
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function listTransactionsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listGstTransactionsQuerySchema.parse(req.query);
    const { rows, totalCount } = await gstService.listGstTransactions({ ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getTransactionHandler(req, res, next) {
  try {
    const { id } = gstTransactionIdParamSchema.parse(req.params);
    return ok(res, await gstService.getGstTransactionOr404(id));
  } catch (err) {
    next(err);
  }
}

export async function createAdjustmentHandler(req, res, next) {
  try {
    const body = createAdjustmentSchema.parse(req.body);
    return created(res, await gstService.createAdjustment(req.user, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Filing periods
// ---------------------------------------------------------------------------

export async function listPeriodsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listPeriodsQuerySchema.parse(req.query);
    const { rows, totalCount, warnings } = await gstService.listPeriods({ ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount), warnings });
  } catch (err) {
    next(err);
  }
}

export async function createPeriodHandler(req, res, next) {
  try {
    const body = createPeriodSchema.parse(req.body);
    return created(res, await gstService.createPeriod(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function getPeriodSummaryHandler(req, res, next) {
  try {
    const { periodId } = periodIdParamSchema.parse(req.params);
    return ok(res, await gstService.getPeriodSummary(periodId));
  } catch (err) {
    next(err);
  }
}

export async function preparePeriodHandler(req, res, next) {
  try {
    const { periodId } = periodIdParamSchema.parse(req.params);
    const body = preparePeriodSchema.parse(req.body);
    return ok(res, await gstService.preparePeriod(req.user, periodId, body));
  } catch (err) {
    next(err);
  }
}

export async function markFiledHandler(req, res, next) {
  try {
    const { periodId } = periodIdParamSchema.parse(req.params);
    const body = markFiledSchema.parse(req.body ?? {});
    return ok(res, await gstService.markPeriodFiled(req.user, periodId, body));
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeHandler(req, res, next) {
  try {
    const { periodId } = periodIdParamSchema.parse(req.params);
    const body = acknowledgeSchema.parse(req.body);
    return ok(res, await gstService.acknowledgePeriod(req.user, periodId, body));
  } catch (err) {
    next(err);
  }
}

export async function filingDataHandler(req, res, next) {
  try {
    const { periodId } = periodIdParamSchema.parse(req.params);
    return ok(res, await gstService.getFilingData(periodId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Summaries and reports
// ---------------------------------------------------------------------------

export async function gstSummaryHandler(req, res, next) {
  try {
    const query = gstSummaryQuerySchema.parse(req.query);
    return ok(res, await gstService.getGstSummary(query));
  } catch (err) {
    next(err);
  }
}

export async function filingHistoryHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const { rows, totalCount } = await gstService.getFilingHistory({ skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}
