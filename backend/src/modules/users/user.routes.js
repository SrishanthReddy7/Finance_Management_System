import { Router } from "express";
import { createUserHandler, setStatusHandler, listUsersHandler } from "./user.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireRoleType } from "../../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

// Fine-grained CREATE_ADMIN/CREATE_EMPLOYEE checks happen inside the
// service (Section 9 logic depends on *which* roleType is being created,
// not just "does this route allow Admins in").
router.post("/", requireRoleType("SUPER_ADMIN", "ADMIN"), createUserHandler);
router.patch("/:id/status", requireRoleType("SUPER_ADMIN", "ADMIN"), setStatusHandler);
router.get("/", requireRoleType("SUPER_ADMIN", "ADMIN"), listUsersHandler);

export default router;
