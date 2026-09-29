import { Router } from "express";
import { getProfileHandler, getSubordinatesHandler, updateEmployeeHandler } from "./employee.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);
router.get("/:id", getProfileHandler);
router.get("/:id/subordinates", getSubordinatesHandler);

// FRS 29.2: "Update profile/manager/department" -- MANAGE_USERS.
router.patch("/:id", requirePermission("MANAGE_USERS"), updateEmployeeHandler);

export default router;
