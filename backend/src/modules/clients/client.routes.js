import { Router } from "express";
import {
  listClientsHandler,
  getClientHandler,
  createClientHandler,
  updateClientHandler,
} from "./client.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";
import { fail } from "../../utils/apiResponse.js";

const router = Router();

router.use(authenticate);

// Reads: any of the permissions whose screens need client data (the
// Clients & Projects pages, and the invoice form's client picker). FRS 29.5
// says reads are "broader" than MANAGE_CLIENTS without naming a code, and a
// client record carries GSTIN/billing/contract details, so a plain login is
// not enough -- an Employee must not be able to list clients via the API.
// SUPER_ADMIN bypasses, as in requirePermission.
const CLIENT_READ_PERMISSIONS = [
  "MANAGE_CLIENTS",
  "MANAGE_PROJECTS",
  "VIEW_FINANCIAL_REPORTS",
  "CREATE_INVOICE",
  "APPROVE_INVOICE",
  "RECORD_CLIENT_PAYMENT",
];

function requireClientRead(req, res, next) {
  if (!req.user) return fail(res, 401, "Not authenticated.");
  if (req.user.roleType === "SUPER_ADMIN") return next();
  if (CLIENT_READ_PERMISSIONS.some((code) => req.user.permissionCodes?.includes(code))) return next();
  return fail(res, 403, `Missing required permission: one of ${CLIENT_READ_PERMISSIONS.join(", ")}`);
}

router.get("/", requireClientRead, listClientsHandler);
router.get("/:id", requireClientRead, getClientHandler);

// Writes: MANAGE_CLIENTS, on the route rather than in the service. Section 30
// gives SUPER_ADMIN a bypass inside requirePermission, so gating here is what
// keeps the CEO from getting a 403 on their own company's master data.
// There is deliberately no DELETE: Section 26 rule 6 -- retire a client by
// PATCHing status to INACTIVE, since Projects and Invoices reference it.
router.post("/", requirePermission("MANAGE_CLIENTS"), createClientHandler);
router.patch("/:id", requirePermission("MANAGE_CLIENTS"), updateClientHandler);

export default router;
