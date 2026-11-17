import { z } from "zod";

export const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).optional(),
    otp: z.string().optional(),
  })
  .refine((data) => Boolean(data.password || data.otp), {
    message: "Either password or OTP must be provided.",
    path: ["password"],
  });

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
  tempToken: z.string().optional(),
});

export const resendOtpSchema = z.object({
  email: z.string().email(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
  newPassword: z.string().min(8, "Password must be at least 8 characters long"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
