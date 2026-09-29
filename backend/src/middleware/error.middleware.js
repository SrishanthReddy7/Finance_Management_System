// Single, centralized error handler. Mounted LAST in app.js, after all routes.
// Anything thrown or passed to next(err) anywhere in the app lands here.

import { fail } from "../utils/apiResponse.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, res) {
  return fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Zod validation errors
  if (err.name === "ZodError") {
    return fail(res, 400, "Validation failed.", err.issues);
  }

  // Multer rejections are client input problems, not server faults. Without
  // this they fall through to the 500 branch (FRS Section 32 expects a clean
  // validation error for an oversized receipt). No stack/internals leak out.
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return fail(res, 400, "File is too large. The maximum receipt size is 5MB.");
    }
    // err.field is the field multer RECEIVED, not the one it wanted -- naming
    // it "expected" here sent a caller round in circles once already.
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return fail(res, 400, `Unexpected file field "${err.field}".`);
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return fail(res, 400, "Upload exactly one file per request.");
    }
    return fail(res, 400, "File upload rejected.");
  }

  // Prisma known request errors (unique constraint, foreign key, etc.)
  if (err.code && String(err.code).startsWith("P")) {
    if (err.code === "P2002") {
      return fail(res, 409, `Duplicate value for: ${err.meta?.target}`);
    }
    if (err.code === "P2025") {
      return fail(res, 404, "Record not found.");
    }
    return fail(res, 400, "Database request error.", env.isProduction ? undefined : err.message);
  }

  // Explicit application errors thrown as { status, message }
  if (err.status) {
    return fail(res, err.status, err.message);
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return fail(res, 500, "Internal server error.", env.isProduction ? undefined : err.stack);
}

// Small helper so services can `throw new AppError(403, "message")`
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
