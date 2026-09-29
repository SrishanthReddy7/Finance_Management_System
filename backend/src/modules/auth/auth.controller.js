import * as authService from "./auth.service.js";
import { loginSchema, refreshSchema } from "./auth.validation.js";
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
  const { passwordHash, ...safeUser } = req.user;
  return ok(res, safeUser);
}
