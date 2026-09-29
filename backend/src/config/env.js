// Loads and validates environment variables once, at startup.
// Fail fast: if something critical is missing, the app should refuse to boot
// rather than crash later mid-request with a confusing error.

import dotenv from "dotenv";
dotenv.config();

const required = ["DATABASE_URL", "JWT_SECRET"];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  // CORS_ORIGIN may be a single origin or a comma-separated list; the `cors`
  // package only does an exact per-request match against a string, so a
  // multi-value string here would never match any real request's Origin
  // header. Split into an array so each origin is matched individually.
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",

  // The company's own GSTIN (FRS 14.3 / 17.4, Section 31 "Settings ... GST
  // registration details"). Deliberately NOT in `required`: the client has not
  // supplied it yet, and invoicing must keep working without it. Its first two
  // characters are the state code, which is the whole basis of the CGST+SGST
  // vs IGST decision -- when it is unset, invoices are still created and
  // totalled correctly but the tax split is skipped and reported as a warning
  // rather than guessed. Set it and the split starts applying to new invoices;
  // no migration or code change is needed.
  companyGstin: (process.env.COMPANY_GSTIN || "").trim().toUpperCase() || null,

  // Razorpay payment gateway (Payment Gateway Stage 4). Deliberately NOT in
  // `required` above, same reasoning as companyGstin: no real credentials
  // exist yet, and nothing that doesn't touch online payments should be
  // unable to boot because of it. The Razorpay client
  // (src/integrations/payment-gateway/razorpay/razorpay.client.js) fails
  // clearly, but only when it is actually constructed/used -- not at server
  // startup.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || null,
    keySecret: process.env.RAZORPAY_KEY_SECRET || null,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null,
    // Falls back to "test" for anything unset or not exactly "test"/"live",
    // rather than passing an unvalidated value through -- this is a mode
    // switch a later stage may branch on, not a free-text field.
    mode: ["test", "live"].includes((process.env.RAZORPAY_MODE || "").trim().toLowerCase())
      ? process.env.RAZORPAY_MODE.trim().toLowerCase()
      : "test",
  },

  // Payout Subsystem Step 2: symmetric key for encrypting
  // EmployeePayoutAccount.accountNumberEncrypted at rest (AES-256-GCM, see
  // utils/fieldEncryption.js). NOT a RazorpayX credential -- purely a local
  // encryption key this application generates and owns. Deliberately NOT in
  // `required` above, same reasoning as razorpay.keySecret: a server that
  // never touches payout accounts must still start cleanly. The encryption
  // utility fails clearly, but only when actually invoked without a
  // configured key.
  payoutFieldEncryptionKey: process.env.PAYOUT_FIELD_ENCRYPTION_KEY || null,

  // RazorpayX (Payout Subsystem Step 3B-1). Deliberately reuses
  // `razorpay.keyId`/`razorpay.keySecret` above rather than separate
  // RAZORPAYX_* credential names -- Step 3A research confirmed RazorpayX and
  // the inbound Payment Gateway share the exact same key_id/key_secret pair
  // on the same account (regenerating one regenerates both), so a second env
  // var pair would only be a second place for the same secret to drift out
  // of sync. Only what is genuinely RazorpayX-specific gets its own name
  // here: the company's own RazorpayX operating current-account number,
  // required by the Payout API's `account_number` field in a later step --
  // NOT used by Contact/Fund Account provisioning, which is all Step 3B-1
  // implements. Deliberately NOT in `required` above -- same "fails only
  // when actually used" convention as every other optional integration in
  // this file.
  razorpayx: {
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || null,
    // Payout Subsystem Step 3C: the RazorpayX payout WEBHOOK's own secret --
    // deliberately a SEPARATE value from both razorpay.keySecret (API auth,
    // intentionally shared with the inbound gateway per Step 3B-1) and
    // razorpay.webhookSecret (the INBOUND gateway's own webhook secret, a
    // different Razorpay product surface/URL entirely). RazorpayX lets each
    // webhook URL configured on the dashboard carry its own secret, and a
    // webhook secret is a different kind of credential from an API key --
    // treating it as interchangeable with either of the above would be
    // exactly the kind of silent cross-wiring this project avoids elsewhere.
    // Deliberately NOT in `required` above -- same "fails only when actually
    // used" convention as every other optional integration in this file.
    webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET || null,
  },
};

// Step 3G production-hardening: a LOCAL, no-network consistency check for
// RazorpayX configuration -- never blocks boot (every RazorpayX variable
// stays optional; a server with none of them configured must still start
// cleanly, same as every check above), only warns when a PARTIAL
// configuration is detected, so a genuine misconfiguration is visible at
// startup rather than surfacing later as an obscure runtime error the first
// time someone actually tries to use it. This does not gate, enable, or
// disable anything -- payout.service.js's own DEFAULT_PROVIDER constant
// (hardcoded "MOCK", not read from any environment variable) is the only
// thing that decides whether a real payout could ever reach RazorpayX, and
// nothing here changes that.
function warnIfRazorpayXConfigIsInconsistent() {
  const hasApiKeys = Boolean(env.razorpay.keyId) && Boolean(env.razorpay.keySecret);
  const hasAccountNumber = Boolean(env.razorpayx.accountNumber);
  const hasWebhookSecret = Boolean(env.razorpayx.webhookSecret);

  if (hasAccountNumber && !hasApiKeys) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config] RAZORPAYX_ACCOUNT_NUMBER is set but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not. " +
        "RazorpayX payout submission would fail with a clear configuration error if ever attempted -- " +
        "this does not affect real payouts today (DEFAULT_PROVIDER is MOCK)."
    );
  }
  if (hasWebhookSecret && !hasAccountNumber) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config] RAZORPAYX_WEBHOOK_SECRET is set but RAZORPAYX_ACCOUNT_NUMBER is not. " +
        "The RazorpayX payout webhook route will still verify and accept deliveries, " +
        "but no real payout could have been submitted yet to produce one."
    );
  }
}
warnIfRazorpayXConfigIsInconsistent();
