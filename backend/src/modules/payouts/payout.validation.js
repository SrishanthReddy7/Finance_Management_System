// Zod layer for the Payout domain (Payout Subsystem Step 2).
//
// Schemas are .strict() so an unknown key is a clean 400 -- same convention
// vendorBill.validation.js documents. No creation schema anywhere in this
// file accepts `amount` for REIMBURSEMENT or SALARY payouts, and none accepts
// a destination account/recipient: the source business object determines
// both, resolved entirely inside payout.service.js. This is deliberate, not
// an oversight -- see payout.service.js's own header comment.

import { z } from "zod";
import { positiveMoney } from "../../utils/zodMoney.js";
import { PAYOUT_STATUSES, PAYOUT_PURPOSES } from "./payout.constants.js";

const uuid = (label) => z.string().uuid(`${label} must be a valid UUID.`);
const reason = z.string().trim().min(1, "A reason is required.").max(500);

// MOCK-only controlled-simulation hint (see mock.provider.js's own doc
// comment). Accepted on every payout-creation schema so a tester can force a
// specific eventual outcome instead of waiting on the default; ignored/
// rejected by payout.service.js for any provider other than MOCK.
// UNCERTAIN (hardening pass, Step 3 audit Section 3.3) makes the submission
// call itself throw as uncertain rather than controlling the eventual
// outcome -- see mock.provider.js's own doc comment.
const simulate = z.enum(["PROCESSED", "FAILED", "REVERSED", "UNCERTAIN"]).optional();

export const reimbursementIdParamSchema = z.object({ reimbursementId: uuid("reimbursementId") });
export const payslipIdParamSchema = z.object({ payslipId: uuid("payslipId") });
export const vendorBillIdParamSchema = z.object({ vendorBillId: uuid("vendorBillId") });
export const payoutIdParamSchema = z.object({ id: uuid("Payout id") });
export const employeeIdParamSchema = z.object({ id: uuid("Employee id") });

export const createReimbursementPayoutSchema = z.object({ simulate }).strict();
export const createSalaryPayoutSchema = z.object({ simulate }).strict();

// FRS 16.3-equivalent for payouts: `amount` mirrors recordVendorPaymentSchema
// exactly (VendorBill already supports partial payment) -- optional here
// because omitting it means "pay the full current outstanding amount",
// resolved and locked in payout.service.js, never trusted blindly even when
// supplied.
export const createVendorPayoutSchema = z
  .object({
    amount: positiveMoney("Payout amount").optional(),
    simulate,
  })
  .strict();

export const rejectPayoutSchema = z.object({ reason }).strict();
export const cancelPayoutSchema = z.object({ reason }).strict();

// Hardening pass (Step 3 audit Section 4.1): validate against the actual
// PayoutStatus values instead of accepting an arbitrary string -- a stray
// value used to reach Prisma and surface as a raw DB-layer error rather
// than a clean 400.
export const listPayoutsQuerySchema = z.object({
  status: z.enum(PAYOUT_STATUSES).optional(),
  purpose: z.enum(PAYOUT_PURPOSES).optional(),
});

// ---------------------------------------------------------------------------
// Employee payout account (minimal, per Step 2 scope)
// ---------------------------------------------------------------------------

const accountHolderName = z.string().trim().min(1, "Account holder name is required.").max(200);
// Digits only, 6-20 -- generous bound covering IBAN-free domestic bank
// account numbers; never echoed back once encrypted.
const accountNumber = z
  .string()
  .trim()
  .regex(/^\d{6,20}$/, "Account number must be 6-20 digits.");
const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must be a valid 11-character code (e.g. HDFC0001234).");
const upiVpa = z
  .string()
  .trim()
  .regex(/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/, "Must be a valid UPI VPA (e.g. name@bank).");

export const setPayoutAccountSchema = z
  .object({
    accountHolderName,
    accountNumber: accountNumber.optional(),
    ifsc: ifsc.optional(),
    upiVpa: upiVpa.optional(),
    // No automated verification exists yet (no RazorpayX). Defaults to
    // UNVERIFIED (the schema's own default) -- MANAGE_PAYOUT_ACCOUNTS holders
    // may set VERIFIED directly, standing in for an offline/manual check
    // (e.g. a penny-drop confirmation done outside this system) until a real
    // verification flow exists.
    verificationStatus: z.enum(["UNVERIFIED", "VERIFIED", "FAILED"]).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.accountNumber) || Boolean(body.upiVpa), {
    message: "Provide either a bank accountNumber (with ifsc) or a upiVpa.",
  })
  .refine((body) => !body.accountNumber || Boolean(body.ifsc), {
    message: "ifsc is required when accountNumber is provided.",
    path: ["ifsc"],
  });
