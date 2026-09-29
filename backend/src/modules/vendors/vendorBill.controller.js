// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission checks live here (they are on the routes
// and in the service respectively), matching every other module.

import * as billService from "./vendorBill.service.js";
import {
  createVendorBillSchema,
  updateVendorBillSchema,
  transitionSchema,
  reasonSchema,
  vendorBillIdParamSchema,
  listVendorBillsQuerySchema,
  recordVendorPaymentSchema,
  payableReportQuerySchema,
} from "./vendorBill.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listVendorBillsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listVendorBillsQuerySchema.parse(req.query);
    const { rows, totalCount } = await billService.listVendorBills({ ...filters, skip, take }, req.user);
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    return ok(res, await billService.getVendorBillOr404(id, req.user));
  } catch (err) {
    next(err);
  }
}

export async function listPaymentsHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    return ok(res, await billService.listPayments(id));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createVendorBillHandler(req, res, next) {
  try {
    const body = createVendorBillSchema.parse(req.body);
    return created(res, await billService.createVendorBill(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = updateVendorBillSchema.parse(req.body);
    return ok(res, await billService.updateVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function submitVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await billService.submitVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function verifyVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await billService.verifyVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function sendForApprovalHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await billService.sendVendorBillForApproval(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function approveVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await billService.approveVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function rejectVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = reasonSchema.parse(req.body ?? {});
    return ok(res, await billService.rejectVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function reopenVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await billService.reopenVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function cancelVendorBillHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = reasonSchema.parse(req.body ?? {});
    return ok(res, await billService.cancelVendorBill(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function recordPaymentHandler(req, res, next) {
  try {
    const { id } = vendorBillIdParamSchema.parse(req.params);
    const body = recordVendorPaymentSchema.parse(req.body);
    return created(res, await billService.recordPayment(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// AP report (FRS 22)
// ---------------------------------------------------------------------------

export async function payableReportHandler(req, res, next) {
  try {
    const query = payableReportQuerySchema.parse(req.query);
    return ok(res, await billService.getPayableReport(query));
  } catch (err) {
    next(err);
  }
}
