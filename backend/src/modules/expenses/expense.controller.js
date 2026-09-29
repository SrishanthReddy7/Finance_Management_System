import fs from "fs";
import * as expenseService from "./expense.service.js";
import {
  createClaimSchema,
  updateClaimSchema,
  reviewSchema,
  reimburseSchema,
  cancelClaimSchema,
  listClaimsQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
  categoryIdParamSchema,
} from "./expense.validation.js";
import { ok, created, fail } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";
import { discardUploadedFile } from "../../middleware/upload.middleware.js";

export async function listCategoriesHandler(req, res, next) {
  try {
    const { includeInactive } = listCategoriesQuerySchema.parse(req.query);
    // Inactive categories are only useful to whoever manages the list; hand
    // them to anyone else and the claim form would offer unclaimable options.
    if (includeInactive && req.user.roleType !== "SUPER_ADMIN" && !req.user.permissionCodes?.includes("VERIFY_EXPENSE")) {
      return fail(res, 403, "Missing required permission: VERIFY_EXPENSE");
    }
    return ok(res, await expenseService.listCategories({ includeInactive }));
  } catch (err) {
    next(err);
  }
}

export async function createCategoryHandler(req, res, next) {
  try {
    const body = createCategorySchema.parse(req.body);
    return created(res, await expenseService.createCategory(req.user, body));
  } catch (err) {
    next(err);
  }
}

export async function updateCategoryHandler(req, res, next) {
  try {
    const { id } = categoryIdParamSchema.parse(req.params);
    const body = updateCategorySchema.parse(req.body);
    return ok(res, await expenseService.updateCategory(req.user, id, body));
  } catch (err) {
    next(err);
  }
}

export async function createClaimHandler(req, res, next) {
  try {
    const body = createClaimSchema.parse(req.body);
    const claim = await expenseService.createClaim(req.user, body);
    return created(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function updateClaimHandler(req, res, next) {
  try {
    const body = updateClaimSchema.parse(req.body);
    const claim = await expenseService.updateClaim(req.user, req.params.id, body);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function submitClaimHandler(req, res, next) {
  try {
    const claim = await expenseService.submitClaim(req.user, req.params.id);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function cancelClaimHandler(req, res, next) {
  try {
    const body = cancelClaimSchema.parse(req.body) || {};
    const claim = await expenseService.cancelClaim(req.user, req.params.id, body);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

/**
 * Runs before multer (see expense.routes.js): rejects an upload the caller is
 * not entitled to make *before* any bytes are written to disk.
 */
export async function guardReceiptUpload(req, res, next) {
  try {
    await expenseService.assertCanAttachReceipt(req.user, req.params.id);
    next();
  } catch (err) {
    next(err);
  }
}

export async function addReceiptHandler(req, res, next) {
  try {
    if (!req.file) {
      return next({
        status: 400,
        message: "No file uploaded. Send one file as multipart/form-data (any field name).",
      });
    }
    const receipt = await expenseService.addReceipt(req.user, req.params.id, req.file);
    return created(res, receipt);
  } catch (err) {
    // The file is already on disk by this point; if the row could not be
    // written, don't leave it orphaned there.
    await discardUploadedFile(req.file);
    next(err);
  }
}

export async function downloadReceiptHandler(req, res, next) {
  try {
    const { absolutePath, mimeType, originalFileName } = await expenseService.getReceiptForDownload(
      req.user,
      req.params.id,
      req.params.receiptId
    );

    if (!fs.existsSync(absolutePath)) {
      return next({ status: 404, message: "Receipt file is no longer available." });
    }

    res.setHeader("Content-Type", mimeType);
    // `inline` so the approvals screen can preview it; the quoted filename
    // keeps a comma or space in the original name from breaking the header.
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(originalFileName)}"`);

    const stream = fs.createReadStream(absolutePath);
    stream.on("error", () => next({ status: 500, message: "Failed to read receipt." }));
    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

export async function getClaimHandler(req, res, next) {
  try {
    const claim = await expenseService.getClaim(req.user, req.params.id);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function listClaimsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const { status, projectId } = listClaimsQuerySchema.parse(req.query);
    const { rows, totalCount } = await expenseService.listClaims(req.user, { skip, take, status, projectId });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function managerReviewHandler(req, res, next) {
  try {
    const body = reviewSchema.parse(req.body);
    const claim = await expenseService.managerReview(req.user, req.params.id, body);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function financeReviewHandler(req, res, next) {
  try {
    const body = reviewSchema.parse(req.body);
    const claim = await expenseService.financeReview(req.user, req.params.id, body);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}

export async function reimburseHandler(req, res, next) {
  try {
    const body = reimburseSchema.parse(req.body);
    const claim = await expenseService.processReimbursement(req.user, req.params.id, body);
    return ok(res, claim);
  } catch (err) {
    next(err);
  }
}
