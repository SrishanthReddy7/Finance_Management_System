import { Router } from "express";
import {
  listVendorsHandler,
  getVendorHandler,
  createVendorHandler,
  updateVendorHandler,
} from "./vendor.controller.js";
import { canSeeVendors, VENDOR_READ_PERMISSIONS } from "./vendor.service.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

const router = Router();

router.use(authenticate);

/**
 * FRS 29.7 puts MANAGE_VENDORS on the whole "POST/GET/PATCH /vendors" row, but
 * Section 31 is more specific about reads -- the Vendors page is "Finance/Admin"
 * -- and a verifier or approver who cannot open the vendor behind the bill they
 * are reviewing cannot do their job. So writes need MANAGE_VENDORS exactly as
 * 29.7 says, while reads accept any AP permission plus Finance's reporting
 * override.
 *
 * requirePermission takes a single code, and this is an OR across five, so the
 * gate is composed here rather than in a handler -- the same place the invoices
 * module puts requireInvoiceRead.
 *
 * Bank details are a second, narrower gate applied per-caller inside the
 * service (see vendor.service.redactVendor): being allowed to read a vendor is
 * not the same as being allowed to see the account its payments go to.
 */
export function requireVendorRead(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (canSeeVendors(req.user)) return next();
  return fail(res, 403, `Missing required permission: one of ${VENDOR_READ_PERMISSIONS.join(", ")}`);
}

// --- Reads ------------------------------------------------------------------
router.get("/", requireVendorRead, listVendorsHandler);
router.get("/:id", requireVendorRead, getVendorHandler);

// --- Writes -----------------------------------------------------------------
// Permission codes sit on the route, never inside the service, so SUPER_ADMIN
// keeps the Section 30 bypass built into requirePermission.
//
// There is deliberately no DELETE (Section 26 rule 6 / FR-18). A vendor is
// retired by PATCHing status to INACTIVE, which keeps it attached to the bills
// already paid to it and blocks new bills being raised against it.
router.post("/", requirePermission("MANAGE_VENDORS"), createVendorHandler);
router.patch("/:id", requirePermission("MANAGE_VENDORS"), updateVendorHandler);

export default router;
