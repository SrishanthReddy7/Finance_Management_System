import * as authService from "./auth.service.js";
import {
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
} from "./auth.validation.js";
import { ok } from "../../utils/apiResponse.js";

export async function loginHandler(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function verifyOtpHandler(req, res, next) {
  try {
    const body = verifyOtpSchema.parse(req.body);
    const result = await authService.verifyOtp(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function resendOtpHandler(req, res, next) {
  try {
    const body = resendOtpSchema.parse(req.body);
    const result = await authService.resendOtp(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordHandler(req, res, next) {
  try {
    const body = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(req, res, next) {
  try {
    const body = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req, res, next) {
  try {
    const body = refreshSchema.parse(req.body);
    const result = await authService.refresh(body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function meHandler(req, res) {
  // req.user is attached by the authenticate middleware
  const safeUser = { ...req.user };
  delete safeUser.passwordHash;
  return ok(res, safeUser);
}
