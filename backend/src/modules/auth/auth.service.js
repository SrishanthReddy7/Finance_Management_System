import { prisma } from "../../config/db.js";
import { comparePassword } from "../../utils/hashPassword.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../../utils/generateToken.js";
import { AppError } from "../../middleware/error.middleware.js";

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { employee: true, role: true },
  });

  // Same error for "no such user" and "wrong password" -- never reveal
  // which one failed (standard practice, avoids user enumeration).
  if (!user) throw new AppError(401, "Invalid email or password.");
  if (user.status !== "ACTIVE") throw new AppError(403, "Account is not active.");

  const passwordMatches = await comparePassword(password, user.passwordHash);
  if (!passwordMatches) throw new AppError(401, "Invalid email or password.");

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      roleType: user.roleType,
      roleName: user.role?.name || null,
      employee: user.employee
        ? { id: user.employee.id, firstName: user.employee.firstName, lastName: user.employee.lastName, designation: user.employee.designation }
        : null,
    },
  };
}

export async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, "Invalid or expired refresh token.");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "ACTIVE") throw new AppError(401, "Account is not active.");

  return { accessToken: generateAccessToken(user) };
}
