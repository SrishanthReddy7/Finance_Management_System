// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission checks live here (they are on the routes
// and in the service respectively), matching every other module.

import * as vendorService from "./vendor.service.js";
import {
  createVendorSchema,
  updateVendorSchema,
  vendorIdParamSchema,
  listVendorsQuerySchema,
} from "./vendor.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

export async function listVendorsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listVendorsQuerySchema.parse(req.query);
    const { rows, totalCount } = await vendorService.listVendors({ ...filters, skip, take }, req.user);
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getVendorHandler(req, res, next) {
  try {
    const { id } = vendorIdParamSchema.parse(req.params);
    return ok(res, await vendorService.getVendorOr404(id, req.user));
  } catch (err) {
    next(err);
  }
}

export async function createVendorHandler(req, res, next) {
  try {
    const body = createVendorSchema.parse(req.body);
    return created(res, await vendorService.createVendor(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateVendorHandler(req, res, next) {
  try {
    const { id } = vendorIdParamSchema.parse(req.params);
    const body = updateVendorSchema.parse(req.body);
    return ok(res, await vendorService.updateVendor(req.user, id, body));
  } catch (err) {
    next(err);
  }
}
