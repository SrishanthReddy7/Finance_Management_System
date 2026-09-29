// Vendor Management (FRS Sections 16.1, 29.7, 31 "Vendors").
//
// Vendors are company-level master data, not per-employee data, so there is no
// hierarchy scoping here -- authorization is a flat permission gate applied at
// the route layer (MANAGE_VENDORS for writes, per FRS 29.7). Nothing in this
// file re-checks permissions; keeping them on the route is what preserves the
// Section 30 SUPER_ADMIN bypass built into requirePermission.
//
// The one exception is bank details, which are redacted per-caller rather than
// per-route -- see redactVendor.
//
// A vendor is never hard-deleted (Section 26 rule 6 / FR-18): it is retired by
// moving status to INACTIVE via PATCH, because VendorBill rows keep pointing
// at it.

import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog, diffChangedFields } from "../audit/audit.service.js";
import { KNOWN_VENDOR_CATEGORIES } from "./vendor.validation.js";

const ENTITY_TYPE = "Vendor";

// The mutable columns, in the order FRS 16.1 lists them. Used for the audit
// diff so a snapshot only ever contains fields that actually changed.
const AUDITED_FIELDS = [
  "name",
  "category",
  "contactEmail",
  "contactPhone",
  "billingAddress",
  "gstin",
  "servicesOffered",
  "paymentTerms",
  "currency",
  "bankDetails",
  "status",
];

const RELATION_COUNT = { select: { bills: true } };

// ---------------------------------------------------------------------------
// Visibility (FRS 31 "Vendors | Finance/Admin | CRUD")
// ---------------------------------------------------------------------------

/**
 * Section 29.7 names MANAGE_VENDORS on the CRUD row but never defines a
 * separate read gate; Section 31 answers it -- the Vendors page is
 * "Finance/Admin". So anyone holding a permission that lets them act on a
 * vendor or its bills, plus Finance's reporting override, can read them.
 *
 * Composed the same way the invoices module composes requireInvoiceRead, and
 * for the same reason: requirePermission takes one code and this is an OR.
 */
export const VENDOR_READ_PERMISSIONS = [
  "MANAGE_VENDORS",
  "VERIFY_VENDOR_BILL",
  "APPROVE_VENDOR_BILL",
  "RECORD_VENDOR_PAYMENT",
  "VIEW_FINANCIAL_REPORTS",
];

export function canSeeVendors(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return VENDOR_READ_PERMISSIONS.some((code) => codes.includes(code));
}

/**
 * FRS Section 32 asks for sensitive fields to be protected, and bank details
 * are the one field on a vendor that is materially more sensitive than the
 * rest: they are what an attacker needs to redirect a payment.
 *
 * Being able to READ a vendor (a user with VIEW_FINANCIAL_REPORTS, say) is not
 * the same as needing its account number, so the column is returned only to
 * callers who maintain vendors or pay them. Same shape as the projects module's
 * per-caller salary redaction: the field is replaced by an explicit marker
 * rather than silently omitted, so a UI can say "hidden" instead of "empty".
 */
const BANK_DETAIL_PERMISSIONS = ["MANAGE_VENDORS", "RECORD_VENDOR_PAYMENT"];

export function canSeeBankDetails(actingUser) {
  if (actingUser.roleType === "SUPER_ADMIN") return true;
  const codes = actingUser.permissionCodes || [];
  return BANK_DETAIL_PERMISSIONS.some((code) => codes.includes(code));
}

export function redactVendor(vendor, actingUser) {
  if (!vendor) return vendor;
  if (canSeeBankDetails(actingUser)) return vendor;
  return { ...vendor, bankDetails: null, bankDetailsRedacted: true };
}

// ---------------------------------------------------------------------------
// Warnings (non-blocking) -- the "warn, do not block" shape the expenses,
// clients and invoices modules already use for judgement calls.
// ---------------------------------------------------------------------------

/**
 * Neither the FRS nor the Vendor table makes name or GSTIN unique, so a
 * duplicate is reported rather than blocked -- two real vendors can share a
 * trading name, and a re-registration can legitimately reuse a GSTIN.
 *
 * A duplicate GSTIN is the stronger signal of the two: a GSTIN identifies one
 * legal entity, so two vendor rows carrying the same one are almost always the
 * same supplier entered twice, which is how a bill ends up paid twice.
 */
async function buildVendorWarnings({ name, gstin, category }, excludeId = null) {
  const warnings = [];
  const not = excludeId ? { id: { not: excludeId } } : {};

  if (name) {
    const duplicates = await prisma.vendor.findMany({
      where: { name: { equals: name, mode: "insensitive" }, ...not },
      select: { id: true, name: true, status: true },
    });
    if (duplicates.length > 0) {
      warnings.push({
        code: "DUPLICATE_VENDOR_NAME",
        message: `${duplicates.length} other vendor(s) already use the name "${name}".`,
        vendors: duplicates,
      });
    }
  }

  if (gstin) {
    const sameGstin = await prisma.vendor.findMany({
      where: { gstin, ...not },
      select: { id: true, name: true, status: true, gstin: true },
    });
    if (sameGstin.length > 0) {
      warnings.push({
        code: "DUPLICATE_VENDOR_GSTIN",
        message:
          `GSTIN ${gstin} is already on ${sameGstin.length} other vendor record(s). ` +
          "A GSTIN identifies one legal entity, so this is very likely the same supplier entered twice.",
        vendors: sameGstin,
      });
    }
  }

  // Section 38 Q30 leaves the category list open, so an unrecognised value is
  // accepted and flagged rather than refused (see vendor.validation.js).
  if (category && !KNOWN_VENDOR_CATEGORIES.includes(category)) {
    warnings.push({
      code: "UNKNOWN_VENDOR_CATEGORY",
      message:
        `"${category}" is not one of the vendor types the client listed in FRS 16.1. It has been saved as given. ` +
        `Known types: ${KNOWN_VENDOR_CATEGORIES.join(", ")}.`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listVendors({ status, category, search, skip, take }, actingUser) {
  const where = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { contactEmail: { contains: search, mode: "insensitive" } },
      { gstin: { contains: search, mode: "insensitive" } },
      { servicesOffered: { contains: search, mode: "insensitive" } },
    ];
  }

  const [rows, totalCount] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip,
      take,
      orderBy: { name: "asc" },
      include: { _count: RELATION_COUNT },
    }),
    prisma.vendor.count({ where }),
  ]);

  return { rows: rows.map((row) => redactVendor(row, actingUser)), totalCount };
}

export async function getVendorOr404(vendorId, actingUser) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { _count: RELATION_COUNT },
  });
  if (!vendor) throw new AppError(404, "Vendor not found.");
  return redactVendor(vendor, actingUser);
}

/**
 * Guard for any module that writes a Vendor foreign key -- today the vendor
 * bills half of this module, tomorrow the Budgets and GST modules. Mirrors
 * assertClientExists / assertProjectAssignable so the rule lives in one place.
 *
 * `requireActive` is false when re-validating a bill that already exists, so a
 * vendor going INACTIVE later never freezes an in-flight bill.
 */
export async function assertVendorAssignable(vendorId, { requireActive = true } = {}) {
  if (!vendorId) return null;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError(400, "The specified vendor does not exist.");
  if (requireActive && vendor.status === "INACTIVE") {
    throw new AppError(
      400,
      `Vendor "${vendor.name}" is inactive; reactivate it before entering a new bill against it.`
    );
  }
  return vendor;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createVendor(actingUser, input) {
  const vendor = await prisma.$transaction(async (tx) => {
    const row = await tx.vendor.create({
      data: {
        name: input.name,
        category: input.category,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        billingAddress: input.billingAddress ?? null,
        gstin: input.gstin ?? null,
        servicesOffered: input.servicesOffered ?? null,
        paymentTerms: input.paymentTerms ?? null,
        bankDetails: input.bankDetails ?? null,
        // currency and status are omitted when not supplied so the schema
        // defaults ("INR" / ACTIVE) apply rather than being overwritten.
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });

    // Section 26 rule 7 / Section 24: the audit row commits with the change it
    // records, never separately. Bank details are deliberately NOT snapshotted
    // into the log -- the audit trail is readable by VIEW_AUDIT_LOGS holders,
    // which is a wider group than the one allowed to see the account number.
    await writeAuditLog(
      {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "CREATE",
        performedById: actingUser.id,
        newValue: {
          name: row.name,
          category: row.category,
          gstin: row.gstin,
          currency: row.currency,
          status: row.status,
          bankDetailsProvided: row.bankDetails != null,
        },
      },
      tx
    );

    return row;
  });

  return {
    ...redactVendor({ ...vendor, _count: { bills: 0 } }, actingUser),
    warnings: await buildVendorWarnings(vendor, vendor.id),
  };
}

export async function updateVendor(actingUser, vendorId, input) {
  const existing = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!existing) throw new AppError(404, "Vendor not found.");

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendor.update({
      where: { id: vendorId },
      data: input,
      include: { _count: RELATION_COUNT },
    });

    const { previousValue, newValue, changed } = diffChangedFields(existing, row, AUDITED_FIELDS);

    // Record THAT the bank details changed, never what they changed to or
    // from: "the payee account was altered" is exactly the event an auditor
    // needs, and the values themselves do not belong in a wider-read table.
    if ("bankDetails" in newValue) {
      previousValue.bankDetails = existing.bankDetails == null ? null : "[redacted]";
      newValue.bankDetails = row.bankDetails == null ? null : "[redacted]";
    }

    // A PATCH that sets every field to the value it already had is a no-op:
    // recording it would pad the trail with empty diffs.
    if (changed) {
      await writeAuditLog(
        {
          entityType: ENTITY_TYPE,
          entityId: vendorId,
          action: "UPDATE",
          performedById: actingUser.id,
          previousValue,
          newValue,
        },
        tx
      );
    }

    return row;
  });

  return {
    ...redactVendor(updated, actingUser),
    warnings: await buildVendorWarnings(updated, updated.id),
  };
}
