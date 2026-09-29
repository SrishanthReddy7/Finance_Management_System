import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Access token: short-lived, sent on every request.
export function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, roleType: user.roleType, roleId: user.roleId || null },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

// Refresh token: longer-lived, used only to mint a new access token.
export function generateRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: "refresh" }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}
