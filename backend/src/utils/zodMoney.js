// Shared money validation for Zod schemas.
//
// Extracted from the invoices module so AP validates amounts identically to AR.
// Behaviour is unchanged from the invoice implementation.
//
// Matches the Decimal(n,2) money columns: a third decimal place is rejected
// rather than silently rounded by Postgres -- on a bill or an invoice that
// difference is something someone will eventually query.
//
// Built as one function rather than a chainable base because `.refine()`
// returns a ZodEffects, which no longer carries `.positive()`/`.max()`; the
// bounds therefore have to be applied before the refinement, not after.

import { z } from "zod";

/** Conservative ceiling shared by the Decimal(12,2) and Decimal(14,2) columns. */
export const DECIMAL_MAX = 9_999_999_999.99;

export function money(label, { min = 0, exclusiveMin = false, max = DECIMAL_MAX } = {}) {
  const base = exclusiveMin
    ? z.number().positive(`${label} must be greater than zero.`)
    : z.number().min(min, `${label} must not be negative.`);

  return base.max(max, `${label} exceeds the maximum storable amount.`).refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
    { message: `${label} must have at most 2 decimal places.` }
  );
}

export const positiveMoney = (label, max) => money(label, { exclusiveMin: true, max });
export const nonNegativeMoney = (label, max) => money(label, { max });

/** FRS 17.4 GST rates: a percentage, not an amount. */
export const taxRate = z
  .number()
  .min(0, "Tax rate must not be negative.")
  .max(100, "Tax rate cannot exceed 100%.")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "Tax rate must have at most 2 decimal places.",
  });

/** 3-letter ISO currency code, uppercased. */
export const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code (e.g. INR, USD).");
