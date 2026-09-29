import { Router } from "express";
import { listAuditLogsHandler } from "./audit.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

// FRS Section 29.9: VIEW_AUDIT_LOGS, "typically Super Admin" (Section 31).
// Ordinary employees hold no such permission and get a 403 here.
router.use(authenticate);
router.get("/", requirePermission("VIEW_AUDIT_LOGS"), listAuditLogsHandler);

export default router;
