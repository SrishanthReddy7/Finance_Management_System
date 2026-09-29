// AES-256-GCM field-level encryption for sensitive columns (Payout Subsystem
// Step 2 -- EmployeePayoutAccount.accountNumberEncrypted). Node's built-in
// crypto module, same as razorpay.service.js's HMAC usage -- no new
// dependency. Mirrors razorpay.client.js's "throw clearly only when actually
// used, never crash the whole app at boot" convention: env.payoutFieldEncryptionKey
// is optional in config/env.js, and this file only fails once encryptField/
// decryptField is actually called without a configured key.

import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST-recommended IV length for GCM

function getKey() {
  const keyHex = env.payoutFieldEncryptionKey;
  if (!keyHex) {
    throw new Error("PAYOUT_FIELD_ENCRYPTION_KEY is not configured; cannot encrypt/decrypt payout account fields.");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("PAYOUT_FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.");
  }
  return key;
}

/**
 * Encrypts `plaintext` and returns one opaque "iv:authTag:ciphertext" hex
 * string, so a single String column can hold the whole result.
 */
export function encryptField(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptField requires a non-empty string.");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Reverses encryptField. Throws (never returns garbage) on a tampered/malformed value -- GCM's auth tag check fails closed. */
export function decryptField(stored) {
  if (typeof stored !== "string") throw new Error("decryptField requires a string.");
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("decryptField received a malformed value.");
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Last 4 digits of an account number, for display -- never the full number. */
export function lastFourDigits(accountNumber) {
  const digitsOnly = String(accountNumber).replace(/\D/g, "");
  return digitsOnly.slice(-4);
}
