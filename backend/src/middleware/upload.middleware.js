// File upload handling for receipts/invoices/payslips (FRS Section 32:
// "File Upload Validation" — restrict mime type, cap size, sanitize name,
// stored outside the web root).

import multer from "multer";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { AppError } from "./error.middleware.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, per FRS Section 32

// Absolute, so the storage location does not depend on the process's cwd.
// Nothing under here is served statically by app.js -- Section 32 wants these
// files outside the web root, so reads go through an authorized endpoint.
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

function storageFor(subfolder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(UPLOAD_ROOT, subfolder);
      try {
        fsSync.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeName = `${crypto.randomUUID()}${ext}`;
      cb(null, safeName);
    },
  });
}

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new AppError(400, "Unsupported file type. Only JPG, PNG, WEBP, and PDF are allowed."));
  }
  cb(null, true);
}

export function uploader(subfolder) {
  return multer({
    storage: storageFor(subfolder),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter,
  });
}

/**
 * Turns a stored `storageKey` back into an absolute path, without ever letting
 * a database value escape its subfolder. basename() strips any directory part
 * (so "../../.env" becomes ".env"), and the containment check is a second
 * belt-and-braces guard. Callers never build paths themselves.
 */
export function resolveUploadPath(subfolder, storageKey) {
  const folder = path.resolve(UPLOAD_ROOT, subfolder);
  const full = path.resolve(folder, path.basename(String(storageKey)));
  if (full !== folder && !full.startsWith(folder + path.sep)) {
    throw new AppError(400, "Invalid file reference.");
  }
  return full;
}

/**
 * Best-effort removal of a just-written upload. Used when the request fails
 * after multer has already put the file on disk, so a rejected upload never
 * leaves an orphan behind. Never throws -- the original error is what matters.
 */
export async function discardUploadedFile(file) {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch {
    // Already gone, or never written. Nothing useful to do here.
  }
}

/**
 * Accepts exactly one file under ANY form-field name, normalized onto
 * `req.file` so handlers stay identical to the `.single()` shape.
 *
 * multer's `.single("receipt")` rejects every other field name with
 * LIMIT_UNEXPECTED_FILE, which turns a harmless client-side naming choice
 * ("file" vs "receipt") into an opaque 400. FRS Section 29.4 specifies the
 * endpoint but no field name, so there is nothing to be gained by being strict
 * about it. The MIME allowlist and the 5MB cap live on the uploader instance
 * and are unaffected by this.
 */
export function singleFileAnyField(upload) {
  const handler = upload.any();

  return (req, res, next) =>
    handler(req, res, async (err) => {
      if (err) return next(err);

      const files = req.files || [];
      if (files.length > 1) {
        // None of them will be persisted, so don't leave any on disk.
        await Promise.all(files.map(discardUploadedFile));
        return next(new AppError(400, "Upload exactly one file per request."));
      }

      req.file = files[0];
      next();
    });
}

export const receiptUpload = uploader("receipts");
export const invoiceUpload = uploader("invoices");
export const payslipUpload = uploader("payslips");
