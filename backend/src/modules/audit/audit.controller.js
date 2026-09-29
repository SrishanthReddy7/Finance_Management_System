import * as auditService from "./audit.service.js";
import { listAuditLogsQuerySchema } from "./audit.validation.js";
import { ok } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

export async function listAuditLogsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listAuditLogsQuerySchema.parse(req.query);
    const { rows, totalCount } = await auditService.listAuditLogs({ ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}
