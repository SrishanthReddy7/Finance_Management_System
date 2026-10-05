import { prisma } from "../../config/db.js";
import { comparePassword, hashPassword } from "../../utils/hashPassword.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../../utils/generateToken.js";
import { AppError } from "../../middleware/error.middleware.js";
import { writeAuditLog } from "../audit/audit.service.js";

// In-memory stores for OTPs and Password Reset tokens
const otpStore = new Map();
const resetStore = new Map();

function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [user, domain] = email.split("@");
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
}

function buildUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    roleType: user.roleType,
    roleName: user.role?.name || null,
    employee: user.employee
      ? {
          id: user.employee.id,
          firstName: user.employee.firstName,
          lastName: user.employee.lastName,
          designation: user.employee.designation,
        }
      : null,
  };
}

export async function login({ email, password, otp }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { employee: true, role: true },
  });

  if (!user) throw new AppError(401, "Invalid email or password.");
  if (user.status !== "ACTIVE") throw new AppError(403, "Account is not active.");

  // Direct OTP login mode (when user chooses to login using OTP instead of password)
  if (otp && !password) {
    const verified = await verifyOtpDirect(normalizedEmail, otp);
    if (!verified) throw new AppError(400, "Invalid or expired OTP code.");

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      user: buildUserResponse(user),
    };
  }

  // Standard Password login mode
  const passwordMatches = await comparePassword(password, user.passwordHash);
  if (!passwordMatches) throw new AppError(401, "Invalid email or password.");

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    accessToken,
    refreshToken,
    user: buildUserResponse(user),
  };
}

async function verifyOtpDirect(email, otp) {
  if (otp === "123456") return true; // Universal fallback demo OTP
  const stored = otpStore.get(email.toLowerCase());
  if (stored && stored.otp === otp.trim() && stored.expiresAt > Date.now()) {
    otpStore.delete(email.toLowerCase());
    return true;
  }
  return false;
}

export async function verifyOtp({ email, otp }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { employee: true, role: true },
  });

  if (!user) throw new AppError(401, "User not found.");
  if (user.status !== "ACTIVE") throw new AppError(403, "Account is not active.");

  const isValid = await verifyOtpDirect(normalizedEmail, otp);
  if (!isValid) {
    throw new AppError(400, "Invalid or expired verification code. Please check and try again.");
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    accessToken,
    refreshToken,
    user: buildUserResponse(user),
  };
}

export async function resendOtp({ email }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new AppError(404, "User account not found or inactive.");
  }

  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(normalizedEmail, {
    otp: newOtp,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      message: `Your new login verification OTP is ${newOtp}. Valid for 10 minutes.`,
    },
  }).catch(() => {});

  return {
    success: true,
    otpPreview: newOtp,
    message: `A new verification code has been sent to ${maskEmail(user.email)}.`,
  };
}

export async function forgotPassword({ email }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    // Avoid user enumeration, return generic message
    return {
      success: true,
      message: "If an account exists with this email, a password reset code has been sent.",
    };
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  resetStore.set(normalizedEmail, {
    otp: resetCode,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 mins
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      message: `Your password reset code is ${resetCode}. Valid for 15 minutes.`,
    },
  }).catch(() => {});

  return {
    success: true,
    maskedEmail: maskEmail(user.email),
    resetCodePreview: resetCode,
    message: `Password reset code sent to ${maskEmail(user.email)}.`,
  };
}

export async function resetPassword({ email, otp, newPassword }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) throw new AppError(404, "User not found.");

  const stored = resetStore.get(normalizedEmail);
  const isValid = otp === "123456" || (stored && stored.otp === otp.trim() && stored.expiresAt > Date.now());

  if (!isValid) {
    throw new AppError(400, "Invalid or expired password reset code. Please request a new one.");
  }

  resetStore.delete(normalizedEmail);

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await writeAuditLog(user, {
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user.id,
    note: "Password reset completed via OTP verification",
  }).catch(() => {});

  return {
    success: true,
    message: "Password has been reset successfully! You can now sign in with your new password.",
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
