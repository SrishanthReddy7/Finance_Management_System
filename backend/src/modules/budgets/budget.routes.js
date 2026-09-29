import { Router } from "express";
import {
  listBudgetsHandler,
  getBudgetHandler,
  getBudgetUtilizationHandler,
  createBudgetHandler,
  updateBudgetHandler,
  setBudgetStatusHandler,
  budgetSummaryHandler,
} from "./budget.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

// --- Reports (FRS 22 "Budget vs Actual") ------------------------------------
// Exported separately because Section 22 mounts reports under /reports, not
// /budgets, mirroring how the invoices/vendor-bills/GST modules export their
// own report routers. Gated on VIEW_FINANCIAL_REPORTS, Section 22's own access
// column for this report.
export const budgetReportRoutes = Router();
budgetReportRoutes.use(authenticate);
budgetReportRoutes.get("/summary", requirePermission("VIEW_FINANCIAL_REPORTS"), budgetSummaryHandler);

// --- Reads -------------------------------------------------------------------
// No requirePermission gate here, same convention as GET /projects: scoping
// happens inside the service (MANAGE_BUDGETS / VIEW_FINANCIAL_REPORTS / Super
// Admin see everything; an assigned project manager sees their own PROJECT
// budgets; everyone else sees nothing) rather than an all-or-nothing 403.
router.get("/", listBudgetsHandler);
router.get("/:id", getBudgetHandler);
router.get("/:id/utilization", getBudgetUtilizationHandler);

// --- Writes ------------------------------------------------------------------
// FRS 29.9 puts MANAGE_BUDGETS on the whole "POST/GET/PATCH /budgets" row.
// Permission codes sit on the route, never inside the service, so SUPER_ADMIN
// keeps the Section 30 bypass built into requirePermission.
//
// There is deliberately no DELETE anywhere in this file (Section 26 rule 6 /
// FR-18). A budget is retired by PATCH /:id/status to CLOSED.
router.post("/", requirePermission("MANAGE_BUDGETS"), createBudgetHandler);
router.patch("/:id", requirePermission("MANAGE_BUDGETS"), updateBudgetHandler);
router.patch("/:id/status", requirePermission("MANAGE_BUDGETS"), setBudgetStatusHandler);

export default router;
