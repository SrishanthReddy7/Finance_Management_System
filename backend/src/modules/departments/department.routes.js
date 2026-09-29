import { Router } from "express";
import {
  listDepartmentsHandler,
  getDepartmentHandler,
  createDepartmentHandler,
  updateDepartmentHandler,
  setDepartmentStatusHandler,
} from "./department.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

// Reads: VIEW_EMPLOYEE, exactly as specified for GET /departments in FRS 29.2.
router.get("/", requirePermission("VIEW_EMPLOYEE"), listDepartmentsHandler);
router.get("/:id", requirePermission("VIEW_EMPLOYEE"), getDepartmentHandler);

// Writes: MANAGE_USERS. No new permission code is introduced -- Section 30's
// seed list defines none for departments, and MANAGE_USERS is already the gate
// FRS 29.2 puts on department reassignment (PATCH /employees/:id). It resolves
// to Super Admin + HR Admin, which matches Section 31's Org/Teams access list.
router.post("/", requirePermission("MANAGE_USERS"), createDepartmentHandler);
router.patch("/:id", requirePermission("MANAGE_USERS"), updateDepartmentHandler);
router.patch("/:id/status", requirePermission("MANAGE_USERS"), setDepartmentStatusHandler);

export default router;
