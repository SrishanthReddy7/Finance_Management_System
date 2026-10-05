import { Router } from "express";
import {
  loginHandler,
  verifyOtpHandler,
  resendOtpHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  refreshHandler,
  meHandler,
} from "./auth.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";

const router = Router();

router.post("/login", loginHandler);
router.post("/verify-otp", verifyOtpHandler);
router.post("/send-otp", resendOtpHandler);
router.post("/resend-otp", resendOtpHandler);
router.post("/forgot-password", forgotPasswordHandler);
router.post("/reset-password", resetPasswordHandler);
router.post("/refresh", refreshHandler);
router.get("/me", authenticate, meHandler);

export default router;
