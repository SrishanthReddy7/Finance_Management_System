// Thin HTTP layer: parse -> call the service -> wrap in the standard envelope.
// No business rules and no permission checks live here (they are on the routes
// and in the service respectively), matching every other module.

import fs from "fs";
import * as invoiceService from "./invoice.service.js";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  transitionSchema,
  cancelInvoiceSchema,
  invoiceIdParamSchema,
  documentIdParamSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
  arReportQuerySchema,
  clientPaymentReportQuerySchema,
} from "./invoice.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";
import { discardUploadedFile } from "../../middleware/upload.middleware.js";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listInvoicesHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const filters = listInvoicesQuerySchema.parse(req.query);
    const { rows, totalCount } = await invoiceService.listInvoices({ ...filters, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    return ok(res, await invoiceService.getInvoiceOr404(id));
  } catch (err) {
    next(err);
  }
}

export async function listPaymentsHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    return ok(res, await invoiceService.listPayments(id));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createInvoiceHandler(req, res, next) {
  try {
    const body = createInvoiceSchema.parse(req.body);
    return created(res, await invoiceService.createInvoice(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = updateInvoiceSchema.parse(req.body);
    return ok(res, await invoiceService.updateInvoice(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function submitInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await invoiceService.submitInvoice(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function approveInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await invoiceService.approveInvoice(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function sendInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = transitionSchema.parse(req.body ?? {});
    return ok(res, await invoiceService.sendInvoice(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function cancelInvoiceHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = cancelInvoiceSchema.parse(req.body ?? {});
    return ok(res, await invoiceService.cancelInvoice(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function recordPaymentHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    const body = recordPaymentSchema.parse(req.body);
    return created(res, await invoiceService.recordPayment(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function syncOverdueHandler(req, res, next) {
  try {
    return ok(res, await invoiceService.syncOverdueInvoices(req.user));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Supporting documents (FRS 14.1)
// ---------------------------------------------------------------------------

/** Runs before multer, so a rejected upload never reaches the disk. */
export async function guardDocumentUpload(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    await invoiceService.assertCanAttachDocument(id);
    next();
  } catch (err) {
    next(err);
  }
}

export async function addDocumentHandler(req, res, next) {
  try {
    const { id } = invoiceIdParamSchema.parse(req.params);
    if (!req.file) {
      return next({ status: 400, message: "No file was uploaded." });
    }
    return created(res, await invoiceService.addDocument(req.user, id, req.file));
  } catch (err) {
    // The file is already on disk at this point; don't leave an orphan behind.
    await discardUploadedFile(req.file);
    next(err);
  }
}

export async function downloadDocumentHandler(req, res, next) {
  try {
    const { id, documentId } = documentIdParamSchema.parse(req.params);
    const { absolutePath, mimeType, originalFileName } = await invoiceService.getDocumentForDownload(id, documentId);

    if (!fs.existsSync(absolutePath)) {
      return next({ status: 404, message: "Document file is no longer available." });
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(originalFileName)}"`);
    const stream = fs.createReadStream(absolutePath);
    stream.on("error", () => next({ status: 500, message: "Failed to read document." }));
    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// AR reports (FRS 15.3, 29.6)
// ---------------------------------------------------------------------------

export async function outstandingReportHandler(req, res, next) {
  try {
    const query = arReportQuerySchema.parse(req.query);
    return ok(res, await invoiceService.getOutstandingReport(query));
  } catch (err) {
    next(err);
  }
}

export async function agingReportHandler(req, res, next) {
  try {
    const query = arReportQuerySchema.parse(req.query);
    return ok(res, await invoiceService.getAgingReport(query));
  } catch (err) {
    next(err);
  }
}

export async function clientPaymentReportHandler(req, res, next) {
  try {
    const query = clientPaymentReportQuerySchema.parse(req.query);
    return ok(res, await invoiceService.getClientPaymentReport(query));
  } catch (err) {
    next(err);
  }
}
