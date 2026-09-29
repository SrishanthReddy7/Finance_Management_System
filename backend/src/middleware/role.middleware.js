// RBAC gate (FRS Section 30). Two independent checks, composed per-route:
//   1. requirePermission(code)  -> "is this permission code granted to my role,
//                                   or am I SUPER_ADMIN (who bypasses this)?"
//   2. requireSelfOrSubordinate(getTargetEmployeeId) -> hierarchy scoping,
//                                   for endpoints about a *specific person's* data.
//
// Keep these OUT of controllers entirely — compose them in the route file.

import { fail } from "../utils/apiResponse.js";
import { canViewSalary } from "../utils/hierarchy.js";

export function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, "Not authenticated.");
    if (req.user.roleType === "SUPER_ADMIN") return next();
    if (req.user.permissionCodes?.includes(code)) return next();
    return fail(res, 403, `Missing required permission: ${code}`);
  };
}

export function requireRoleType(...allowedRoleTypes) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, "Not authenticated.");
    if (allowedRoleTypes.includes(req.user.roleType)) return next();
    return fail(res, 403, "You do not have access to this resource.");
  };
}

// For salary-shaped data specifically: self OR hierarchy OR explicit override
// permission (e.g. VIEW_COMPANY_SALARY for HR/Finance).
export function requireSalaryAccess(getTargetEmployeeId, overridePermission = "VIEW_COMPANY_SALARY") {
  return async (req, res, next) => {
    if (!req.user) return fail(res, 401, "Not authenticated.");

    const targetEmployeeId = await getTargetEmployeeId(req);
    if (!targetEmployeeId) return fail(res, 404, "Employee not found.");

    if (req.user.permissionCodes?.includes(overridePermission)) return next();

    const allowed = await canViewSalary(req.user, targetEmployeeId);
    if (!allowed) {
      // 404, not 403: per FRS 8.3, avoid confirming another employee's
      // salary record even exists to someone who can't see it.
      return fail(res, 404, "Employee not found.");
    }
    next();
  };
}
