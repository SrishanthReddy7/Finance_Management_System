import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import * as controller from "./notification.controller.js";

const router = Router();

// All notification routes require authenticated user
router.use(authenticate);

router.get("/", controller.listNotifications);
router.post("/mark-all-read", controller.markAllAsRead);
router.patch("/:id/read", controller.markAsRead);

export default router;
