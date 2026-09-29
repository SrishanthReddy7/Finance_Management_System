import * as payoutService from "./payout.service.js";
import * as payoutAccountService from "./payoutAccount.service.js";
import {
  createReimbursementPayoutSchema,
  createSalaryPayoutSchema,
  createVendorPayoutSchema,
  rejectPayoutSchema,
  cancelPayoutSchema,
  listPayoutsQuerySchema,
  setPayoutAccountSchema,
} from "./payout.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

export async function createReimbursementPayoutHandler(req, res, next) {
  try {
    const body = createReimbursementPayoutSchema.parse(req.body ?? {});
    const payout = await payoutService.createReimbursementPayout(req.user, req.params.reimbursementId, body);
    return created(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function createSalaryPayoutHandler(req, res, next) {
  try {
    const body = createSalaryPayoutSchema.parse(req.body ?? {});
    const payout = await payoutService.createSalaryPayout(req.user, req.params.payslipId, body);
    return created(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function createVendorPayoutHandler(req, res, next) {
  try {
    const body = createVendorPayoutSchema.parse(req.body ?? {});
    const payout = await payoutService.createVendorPayout(req.user, req.params.vendorBillId, body);
    return created(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function approvePayoutHandler(req, res, next) {
  try {
    const payout = await payoutService.approvePayout(req.user, req.params.id);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function rejectPayoutHandler(req, res, next) {
  try {
    const body = rejectPayoutSchema.parse(req.body);
    const payout = await payoutService.rejectPayout(req.user, req.params.id, body);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function cancelPayoutHandler(req, res, next) {
  try {
    const body = cancelPayoutSchema.parse(req.body);
    const payout = await payoutService.cancelPayout(req.user, req.params.id, body);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function syncPayoutHandler(req, res, next) {
  try {
    const payout = await payoutService.syncPayoutStatus(req.user, req.params.id);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function retryPayoutHandler(req, res, next) {
  try {
    const payout = await payoutService.retryPayout(req.user, req.params.id);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function getPayoutHandler(req, res, next) {
  try {
    const payout = await payoutService.getPayoutOr404(req.params.id);
    return ok(res, payout);
  } catch (err) {
    next(err);
  }
}

export async function listPayoutsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const { status, purpose } = listPayoutsQuerySchema.parse(req.query);
    const { rows, totalCount } = await payoutService.listPayouts({ status, purpose, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function setPayoutAccountHandler(req, res, next) {
  try {
    const body = setPayoutAccountSchema.parse(req.body);
    const account = await payoutAccountService.setActivePayoutAccount(req.user, req.params.id, body);
    return created(res, account);
  } catch (err) {
    next(err);
  }
}

export async function getPayoutAccountHandler(req, res, next) {
  try {
    const account = await payoutAccountService.getActivePayoutAccount(req.params.id);
    return ok(res, account);
  } catch (err) {
    next(err);
  }
}
