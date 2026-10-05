// Verifies the JWT and attaches the full user (with role/permissions/employee)
// to req.user. Every protected route depends on this running first.

import { verifyAccessToken } from "../utils/generateToken.js";
import { prisma } from "../config/db.js";
import { fail } from "../utils/apiResponse.js";

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return fail(res, 401, "Missing or malformed Authorization header.");
    }

    const payload = verifyAccessToken(token); // throws if invalid/expired

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        employee: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      return fail(res, 401, "Account is not active.");
    }

    // Flatten permission codes onto req.user for easy checking downstream.
    req.user = {
      ...user,
      permissionCodes: (user.role?.permissions || []).map((rp) => rp.permission.code),
    };

    next();
  } catch {
    return fail(res, 401, "Invalid or expired token.");
  }
}
